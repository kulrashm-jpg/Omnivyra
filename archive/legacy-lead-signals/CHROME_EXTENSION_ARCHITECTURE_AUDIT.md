# Chrome Extension Integration Architecture Audit
## Omnivyra Engagement Command Center

**Date:** March 23, 2026  
**Audit Scope:** Architecture readiness for Chrome extension-driven engagement system  
**Platforms:** LinkedIn, YouTube (primary focus)  
**System:** Multi-tenant (organization_id, user_id) Next.js/TypeScript backend

---

## 📋 EXECUTIVE SUMMARY

### Current State
✅ **Existing Engagement Command Center is 65% ready** for extension integration:
- Unified inbox model (engagement_threads, engagement_messages)
- Multi-platform message ingestion pipeline
- AI reply generation infrastructure
- Credit system for action execution
- Community AI action orchestration layer
- Opportunity detection and lead scoring

❌ **Critical Gaps for Extension Model:**
- No extension event isolation table
- No command queue for extension→platform operations (only polling-based comments ingestion)
- No real-time event bus (polling-based only)
- No platform-agnostic message type abstraction (assumes comments/replies)
- Missing data models for non-comment engagement (likes, shares, DMs, mentions)
- No extension session/authentication management
- No bidirectional communication protocol
- No webhook validation / signature verification

### Recommendation
**Implement Option B: Unified Extension Layer**
- Create new `/extension` module separate from existing engagement
- Extend existing engagement_* tables with extension-specific columns
- Build abstraction for DM, comment, mention, like, share normalizations
- Add event streaming instead of pure polling
- Integrate with existing Community AI action executor

---

## 1. SYSTEM OVERVIEW

### 1.1 Architecture Layers

```
┌─────────────────────────────────────────────────┐
│         Frontend UI (Next.js Pages)             │
│   /pages/engagement/* (Inbox, Threads, etc)    │
├─────────────────────────────────────────────────┤
│    API Request/Response (REST via /api/*)       │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌────────────────────┐   ┌──────────────────┐ │
│  │  Service Layer     │   │  Integration     │ │
│  ├────────────────────┤   ├──────────────────┤ │
│  │ - Engagement Inbox │   │ - Platform       │ │
│  │ - Messages         │   │   Adapters       │ │
│  │ - AI Reply Gen     │   │ - OAuth Config   │ │
│  │ - Opp Detection    │   │ - Token Store    │ │
│  │ - Lead Scoring     │   │                  │ │
│  │ - Community AI     │   │ [NEW] Extension  │ │
│  │   Actions          │   │   Interface      │ │
│  └────────────────────┘   └──────────────────┘ │
│                                                 │
│  ┌────────────────────┐   ┌──────────────────┐ │
│  │  Queue/Workers     │   │  Intelligence    │ │
│  ├────────────────────┤   ├──────────────────┤ │
│  │ - Engagement       │   │ - Scoring Engine │ │
│  │   Polling Worker   │   │ - Signal Store   │ │
│  │ - Lead Thread      │   │ - Analytics      │ │
│  │   Recompute        │   │                  │ │
│  │ - Opp Detection    │   │                  │ │
│  │   Worker           │   │                  │ │
│  └────────────────────┘   └──────────────────┘ │
│                                                 │
├─────────────────────────────────────────────────┤
│  Database (Supabase PostgreSQL + Row-Level      │
│  Security, Views, Triggers, Custom Types)       │
├─────────────────────────────────────────────────┤
│  External Services (LinkedIn, Twitter, etc)     │
└─────────────────────────────────────────────────┘
```

### 1.2 Key Tenets
1. **Multi-tenant:** All operations scoped to organization_id (company) and user_id
2. **Event-driven:** Behind-the-scenes work via BullMQ (Redis-backed queue system)
3. **Credit-based:** All AI and automation actions consume organization credits
4. **Platform-agnostic:** Supports LinkedIn, Twitter/X, Facebook, Instagram, YouTube, Reddit
5. **AI-first:** Leverages OpenAI for response generation and intent classification

---

## 2. EXISTING ENGAGEMENT ARCHITECTURE

### 2.1 Core Tables (Unified Data Model)

#### A. **engagement_sources** (Platform Registry)
```sql
id UUID PRIMARY KEY
platform TEXT (linkedin, twitter, instagram, etc)
source_type TEXT (api, webhook, extension)
created_at TIMESTAMPTZ
```
**Purpose:** De-duplicates platforms; single source of truth for which platforms are active.

#### B. **engagement_authors** (Normalized Author Profile)
```sql
id UUID PRIMARY KEY
platform TEXT
platform_user_id TEXT  -- LinkedIn ID, Twitter Handle, etc
username TEXT
display_name TEXT
profile_url TEXT
avatar_url TEXT
created_at TIMESTAMPTZ
```
**Purpose:** Normalizes author identity across multiple mentions/threads.

#### C. **engagement_threads** (Conversation Container)
```sql
id UUID PRIMARY KEY
platform TEXT
platform_thread_id TEXT  -- LinkedIn post ID, YouTube video ID, etc
root_message_id UUID       -- Refs engagement_messages.id
source_id UUID             -- Refs engagement_sources.id
organization_id UUID       -- CRITICAL: multi-tenant scope
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ

-- RLS Policy: users can only access threads where organization_id matches their company
```
**Purpose:** Groups messages (comments, replies, DMs) into logical threads.  
**Current Usage:** Primarily LinkedIn post comments, some Twitter replies.

#### D. **engagement_messages** (Unified Message Format)
```sql
id UUID PRIMARY KEY
thread_id UUID             -- Refs engagement_threads.id
source_id UUID             -- Refs engagement_sources.id
author_id UUID             -- Refs engagement_authors.id
platform TEXT
platform_message_id TEXT   -- Unique per platform
message_type TEXT          -- 'comment', 'reply', 'dm', 'mention', 'like', 'share'
parent_message_id UUID     -- For nested replies
content TEXT
raw_payload JSONB          -- Platform-specific metadata
like_count INTEGER
reply_count INTEGER
sentiment_score NUMERIC    -- -1 to 1
created_at TIMESTAMPTZ
platform_created_at TIMESTAMPTZ

-- Linked to post_comments for legacy traceability
post_comment_id UUID REFERENCES post_comments(id)
```
**Purpose:** Normalized engagement message (comments, replies, DMs, etc).  
**Challenge:** Currently assumes only comments; needs extension for DMs, likes, etc.

#### E. **engagement_thread_classification** (Intent Detection)
```sql
id UUID PRIMARY KEY
thread_id UUID REFERENCES engagement_threads(id)
classification_category TEXT  -- 'question', 'support', 'feedback', 'spam'
confidence NUMERIC
```

#### F. **engagement_thread_intelligence** (Aggregated Thread Metadata)
```sql
id UUID PRIMARY KEY
thread_id UUID REFERENCES engagement_threads(id)
dominant_intent TEXT
lead_detected BOOLEAN
negative_feedback BOOLEAN
customer_question BOOLEAN
influencer_detected BOOLEAN
priority_reason TEXT
confidence_score NUMERIC
updated_at TIMESTAMPTZ
```
**Purpose:** One-row cache of thread priority signals for inbox ranking.

#### G. **engagement_message_intelligence** (Per-Message AI Analysis)
```sql
id UUID PRIMARY KEY
message_id UUID REFERENCES engagement_messages(id)
intent TEXT         -- 'inquiry', 'feedback', 'objection', 'praise'
sentiment TEXT      -- 'positive', 'negative', 'neutral', 'intent'
topic TEXT
is_question BOOLEAN
is_complaint BOOLEAN
updated_at TIMESTAMPTZ
```

#### H. **engagement_opportunities** (Actionable Engagement)
```sql
id UUID PRIMARY KEY
organization_id UUID
source_thread_id UUID REFERENCES engagement_threads(id)
source_message_id UUID REFERENCES engagement_messages(id)
opportunity_type TEXT     -- 'lead', 'upsell', 'brand_mention', 'complaint'
detected_at TIMESTAMPTZ
resolved BOOLEAN DEFAULT FALSE
resolved_action TEXT      -- 'replied', 'ignored', 'escalated'
resolved_at TIMESTAMPTZ
metadata JSONB
```
**Purpose:** Signals that an engagement requires action (e.g., lead mention, complaint).

#### I. **engagement_lead_signals** (Lead Scoring)
```sql
id UUID PRIMARY KEY
thread_id UUID
message_id UUID
organization_id UUID
lead_score NUMERIC (0-100)
lead_confidence NUMERIC
lead_classification TEXT     -- 'high_value', 'medium', 'low', 'not_lead'
identified_intent TEXT
created_at TIMESTAMPTZ
```

#### J. **engagement_signals** (Engagement Activity Tracking)
```sql
id UUID PRIMARY KEY
organization_id UUID
thread_id UUID
event_type TEXT            -- 'comment_received', 'reply_sent', 'opportunity_detected'
signal_source TEXT         -- 'api', 'webhook', 'polling'
metadata JSONB
created_at TIMESTAMPTZ
```

#### K. **community_ai_actions** (Action Queue & History)
```sql
id UUID PRIMARY KEY
tenant_id UUID
organization_id UUID
platform TEXT
action_type TEXT           -- 'like', 'reply', 'share', 'follow', 'schedule'
target_id TEXT             -- Post/comment/user ID on platform
suggested_text TEXT        -- For reply-type actions
playbook_id UUID           -- Links to automation rules
discovered_user_id UUID    -- Who is being engaged
status TEXT                -- 'pending', 'executed', 'failed', 'skipped'
execution_mode TEXT        -- 'api', 'rpa', 'manual'
risk_level TEXT            -- 'low', 'medium', 'high'
requires_approval BOOLEAN
created_at TIMESTAMPTZ
executed_at TIMESTAMPTZ
```
**Purpose:** Queue for all engagement actions (both inbound ingestion triggers and outbound commands).

#### L. **community_ai_discovered_users** (Network Intelligence)
```sql
id UUID PRIMARY KEY
organization_id UUID
platform TEXT
platform_user_id TEXT
username TEXT
display_name TEXT
profile_url TEXT
avatar_url TEXT
discovery_source TEXT      -- 'comment', 'reply', 'mention', 'extension'
engagement_count INTEGER
last_engaged_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

### 2.2 Related Tables (Supporting Infrastructure)

| Table | Purpose |
|-------|---------|
| `social_accounts` | Org's own social accounts (linked to OAuth tokens) |
| `platform_oauth_configs` | Per-org, per-platform OAuth settings |
| `platform_tokens` | Encrypted access/refresh tokens for API calls |
| `post_comments` | Legacy comments table (being phased out in favor of engagement_messages) |
| `scheduled_posts` | Published posts (ingest polls recent ones for comments) |
| `organization_credits` | Credit balance per organization |

### 2.3 Current Data Flow: Comment Ingestion

```
Scheduled Post (published) → Engagement Polling Cron
                              ↓
                    Query last 30 days' posts
                              ↓
                  For each post: ingestComments()
                              ↓
          Call Platform API (LinkedIn, Twitter, etc)
                              ↓
         Normalize to IngestCommentRow[] format
                              ↓
              Upsert into engagement_messages
                              ↓
              Sync to post_comments (legacy)
                              ↓
         Trigger: engagement_message_intelligence
                              ↓
          Run: engagementOpportunityDetectionWorker
                   (detects leads, complaints)
                              ↓
        Update engagement_opportunities table
                              ↓
    Frontend queries /api/engagement/* endpoints
                              ↓
           Display in Engagement Command Center
```

**Key Observations:**
- **Polling-based:** No real-time event ingestion; depends on cron job every 60 seconds.
- **Comment-focused:** Only designed for comments/replies; not DMs, mentions, likes.
- **No command queue:** No outbound action queue for extension-initiated operations.

---

## 3. EXISTING ENGAGEMENT API ENDPOINTS

### 3.1 Available Endpoints (Sample)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/engagement/platform-counts` | Returns unread counts per platform |
| GET | `/api/engagement/threads` | List engagement threads with filters |
| GET | `/api/engagement/unified` | List all engagement messages (multi-platform) |
| POST | `/api/engagement/reply` | Submit reply to engagement message |
| POST | `/api/engagement/thread/bulk-ai-reply` | Batch AI reply generation |
| POST | `/api/engagement/thread/bulk-resolve` | Resolve multiple opportunities |
| POST | `/api/engagement/thread/ignore` | Ignore engagement thread |
| GET | `/api/engagement/opportunity-radar` | Get opportunity summary |
| GET | `/api/engagement/suggestions` | Get AI reply suggestions |
| POST | `/api/engagement/reply-intelligence` | Log reply performance |

### 3.2 Example: GET /api/engagement/unified

```typescript
// Query params
?organization_id=UUID
&limit=50
&offset=0
&sentiment=negative|neutral|positive|intent

// Response
{
  "data": [
    {
      "id": "msg-uuid",
      "platform": "linkedin",
      "action_type": "comment",
      "target_id": "linkedin-comment-id",
      "suggested_text": "Thanks for your interest...",
      "intent_classification": { "sentiment": "positive", "intent": "inquiry" },
      "tone": "professional",
      "status": "pending",
      "discovered_user_id": "user-uuid",
      "created_at": "2026-03-23T11:14:44Z"
    }
  ]
}
```

### 3.3 Example: POST /api/engagement/reply

```typescript
{
  "organization_id": "UUID",
  "thread_id": "UUID",
  "message_id": "UUID",
  "reply_text": "Thanks for your feedback!",
  "platform": "linkedin",
  "ai_generated": true
}

// Response
{
  "ok": true,
  "action_id": "UUID",
  "status": "executed|pending|failed",
  "credits_consumed": 1
}
```

---

## 4. AI & REPLY GENERATION PIPELINE

### 4.1 Reply Generation Service

**File:** `backend/services/replyGenerationService.ts`

```typescript
async function generateReply(options: {
  threadId: string;
  messageId: string;
  organizationId: string;
  context?: any;
  tone?: 'professional' | 'casual' | 'empathetic';
}): Promise<{ reply_text: string; ai_model: string }> {
  // 1. Fetch engagement_messages for context
  // 2. Fetch company_profiles for brand voice
  // 3. Call OpenAI API with prompt
  // 4. Validate response length & safety
  // 5. Return suggested_text
}
```

### 4.2 Engagement Opportunity Detection Worker

**File:** `backend/workers/engagementOpportunityDetectionWorker.ts`

Triggered when:
1. New engagement_message inserted
2. `engagement_message_intelligence` computed
3. Check engagement_lead_signals for lead score > threshold

Outputs:
- Creates `engagement_opportunities` row
- Triggers notification
- Queues Community AI action if auto-reply enabled

### 4.3 Community AI Action Executor

**File:** `backend/services/communityAiActionExecutor.ts`

```typescript
type CommunityAiAction = {
  id: string;
  organization_id: string;
  platform: string;
  action_type: 'like' | 'reply' | 'share' | 'follow' | 'schedule';
  target_id: string;
  suggested_text?: string | null;
  playbook_id?: string | null;  // Automation rule ID
  requires_approval?: boolean;
  execution_mode?: 'api' | 'rpa' | 'manual';
  risk_level?: 'low' | 'medium' | 'high';
};

async function executeAction(
  action: CommunityAiAction,
  approved: boolean
): Promise<ExecutionResult> {
  // 1. Validate action against playbook
  // 2. Check organization credits
  // 3. Load platform connector
  // 4. Execute via API or RPA
  // 5. Log action_event for performance tracking
  // 6. Deduct credits
  // 7. Update community_ai_actions.status
}
```

---

## 5. CREDIT SYSTEM & USAGE TRACKING

### 5.1 Credit Model

**Organization has:**
- `balance_credits` (current available)
- `lifetime_purchased` (total bought)
- `lifetime_consumed` (total spent)

**Credit costs** (in `CREDIT_COSTS` enum):
| Action | Cost |
|--------|------|
| ai_reply | 1 |
| auto_post | 2 |
| reply_generation | 2 |
| trend_analysis | 25 |
| campaign_creation | 40 |
| lead_detection | 15 (only if lead found) |
| daily_insight_scan | 20 (only if actionable) |

### 5.2 Credit Enforcement

1. **Pre-check:** `checkUsageBeforeExecution()` in `usageEnforcementService`
2. **Deduction:** `incrementUsageMeter()` + `creditExecutionService`
3. **Logging:** `logUsageEvent()` tracks every consumption
4. **Expiry:** `creditExpiryService` manages time-limited credits

**Key Point:** Extension events should:
- Count as `ai_reply` (1 credit) for reply actions
- Count as `reply_generation` (2 credits) for AI suggestion
- Be subject to same credit checks as UI actions

---

## 6. INTELLIGENCE LAYER (Scoring & Analytics)

### 6.1 Lead Scoring System

**File:** `backend/services/leadService.ts`

```typescript
async function scoreAsLead(
  messageId: string,
  threadId: string,
  organizationId: string
): Promise<{ score: number; classification: string }> {
  // 1. Extract text features (keywords, tone, intent)
  // 2. Fetch engagement_authors profile history
  // 3. Check if author has >N previous interactions
  // 4. Compute lead_score via ML model or rules engine
  // 5. Classify as: high_value | medium | low | not_lead
  // 6. Store in engagement_lead_signals
}
```

### 6.2 Engagement Signals & Analytics

**File:** `backend/services/engagementSignalCollector.ts`

Tracks:
- Comment volume per thread
- Response time to engagement
- AI reply acceptance rate
- Lead conversion rate
- Negative feedback rate

**Supports:**
- Authority score (how often author is cited/shared)
- Visibility score (reach of engagement)
- Engagement quality (sentiment-adjusted)
- Content performance (linked to scheduled_posts)

### 6.3 Intelligence Query Templates

**File:** `backend/services/intelligenceQueryBuilder.ts`

Provides prebuilt queries for:
- "Top engagement by sentiment (last 7 days)"
- "Lead-scoring distribution"
- "Platform comparison (engagement vs. leads)"
- "Author influence ranking"

---

## 7. GAPS ANALYSIS: EXTENSION REQUIREMENTS vs. CURRENT STATE

### 7.1 Critical Gaps

| Gap | Severity | Current State | Blocker? |
|-----|----------|---------------|----------|
| **Extension event table** | 🔴 Critical | None | YES - needs isolation |
| **Real-time event bus** | 🔴 Critical | Polling only (60s cycle) | YES - needs sub-second |
| **DM/message support** | 🔴 Critical | Comment-only (post_comments legacy) | YES - depends on data model |
| **Extension command queue** | 🔴 Critical | Community AI queue exists but not for extension commands | YES - needs routing |
| **Platform adapter for extension events** | 🟠 High | Adapters exist for API calls only | YES - needs extension API |
| **Extension session/auth** | 🟠 High | No token management for extension | YES - needs separate flow |
| **Webhook signature validation** | 🟠 High | Exists in other parts, not for extension | MEDIUM |
| **Bidirectional sync** | 🟠 High | One-way (poll + ingest only) | YES |
| **Non-comment engagement** | 🟠 High | Likes, shares, mentions not stored | MEDIUM - partial support |
| **Message deduplication** | 🟠 High | Single-source (API polling only) | YES - multi-source problem |
| **Engagement classification** | 🟡 Medium | Exists but basic | NO - can be enhanced |
| **Performance metrics for extension** | 🟡 Medium | Exists for replies; needs extension telemetry | NO - can add |

### 7.2 Data Model Gaps

#### A. No Extension Events Isolation
**Current:** All engagement_messages merged into single table.  
**Problem:** Can't distinguish:
- API-polled comments vs. extension-pushed events
- Extension authenticity
- Extension user identity

**Solution:**
```sql
CREATE TABLE extension_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  extension_version TEXT NOT NULL,
  extension_user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  event_type TEXT,  -- 'comment', 'message', 'reply', 'like', 'mention'
  event_payload JSONB NOT NULL,
  raw_platform_data JSONB,
  normalized_to_engagement_message_id UUID,
  signature_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### B. No Multi-Message Type Support
**Current:** `engagement_messages.message_type` is assumed 'comment' or 'reply'.  
**Problem:** DMs have different structure (no thread_id = post_id), likes have no content, etc.

**Solution:** Extend message_type enum:
```typescript
type MessageType = 
  | 'comment'      // On post
  | 'reply'        // Reply to comment
  | 'dm'           // Direct message
  | 'mention'      // @mention in post
  | 'like'         // Like action
  | 'share'        // Share/retweet
  | 'dm_reply'     // Reply in DM thread
```

#### C. No Platform-Specific Context
**Current:** Raw metadata shoved in JSONB; no schema validation.  
**Problem:** Can't query "LinkedIn articles mentioning our brand" or "YouTube replies with replies".

**Solution:**
```sql
-- LinkedIn-specific context
CREATE TABLE engagement_linkedin_context (
  message_id UUID PRIMARY KEY REFERENCES engagement_messages(id),
  linked_article_id TEXT,
  article_title TEXT,
  is_verified_commenter BOOLEAN,
  creator_profile_url TEXT
);

-- YouTube-specific context
CREATE TABLE engagement_youtube_context (
  message_id UUID PRIMARY KEY REFERENCES engagement_messages(id),
  video_id TEXT NOT NULL,
  video_title TEXT,
  channel_id TEXT,
  reply_count_on_comment INTEGER,
  likes_on_comment INTEGER
);
```

#### D. No Extension Command Result Tracking
**Current:** community_ai_actions logs execution, but no feedback loop for:
- Did the command actually execute on platform?
- Was it rejected? Why?
- What was the platform response?

**Solution:**
```sql
CREATE TABLE extension_command_results (
  id UUID PRIMARY KEY,
  command_id UUID REFERENCES extension_commands(id),
  platform_response JSONB,
  http_status_code INTEGER,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  result_timestamp TIMESTAMPTZ DEFAULT now()
);
```

### 7.3 API Gaps

| Gap | Endpoint | Status |
|-----|----------|--------|
| Extension event ingestion | `/api/extension/events` (POST) | ❌ MISSING |
| Extension commands | `/api/extension/commands` (POST/GET) | ❌ MISSING |
| Extension action results | `/api/extension/action-result` (POST) | ❌ MISSING |
| Extension session/token | `/api/extension/auth` | ❌ MISSING |
| Webhook validation | (built-in signature verification) | ⚠️ PARTIAL |

### 7.4 Worker/Queue Gaps

| Worker | Purpose | Status |
|--------|---------|--------|
| extension-event-processor | Handle extension event→engagement_message mapping | ❌ MISSING |
| extension-command-executor | Execute commands on platform (like community_ai but different entry) | ❌ MISSING |
| extension-deduplication | Merge extension events with API-polled data | ❌ MISSING |

---

## 8. RECOMMENDED ARCHITECTURE

### 8.1 Option A: Monolithic (Extend existing engagement)
```
❌ NOT RECOMMENDED
```
**Pros:**
- Cheaper to implement (1-2 weeks)
- Less code duplication

**Cons:**
- Extension events mixed with API polling → deduplication hell
- Hard to isolate extension issues
- No clear separation of concerns
- Extension auth/session logic polluted in engagement service

---

### 8.2 Option B: Unified Extension Layer ✅ RECOMMENDED
```
✅ RECOMMENDED
```

**Create new module structure:**

```
backend/
├── services/
│   ├── extensions/                          [NEW]
│   │   ├── extensionEventService.ts         (ingest, normalize)
│   │   ├── extensionCommandService.ts       (queue, dedup)
│   │   ├── extensionSessionService.ts       (auth, tokens)
│   │   ├── extensionSignatureService.ts     (webhook validation)
│   │   └── extensionAnalyticsService.ts     (telemetry)
│   │
│   ├── engagementNormalizationService.ts    (UPDATED)
│   │   ├── normalizeExtensionEvent()        [NEW function]
│   │   ├── normalizeLinkedInDM()            [NEW function]
│   │   ├── normalizeYouTubeReply()          [NEW function]
│   │   └── mergeWithAppApiData()            [NEW function]
│   │
│   └── [existing]
│       ├── engagementInboxService.ts
│       ├── communityAiActionExecutor.ts
│       └── engagementOpportunityDetectionWorker.ts
│
├── queue/
│   └── jobProcessors/
│       ├── extensionEventProcessor.ts       [NEW]
│       ├── extensionCommandProcessor.ts     [NEW]
│       └── extensionDeduplicateProcessor.ts [NEW]
│
└── integration/
    ├── extensionWebhookHandler.ts            [NEW — validates & queues events]
    └── [existing platform adapters]
```

### 8.3 Data Model Changes (Option B)

#### New Tables

```sql
-- 1. Extension registration & secrets
CREATE TABLE extension_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id),
  extension_id TEXT NOT NULL,           -- unique per-org extension instance
  extension_version TEXT,               -- semver
  platform TEXT NOT NULL,                -- 'linkedin', 'youtube'
  api_key TEXT ENCRYPTED,               -- for webhook auth
  webhook_secret TEXT ENCRYPTED,        -- HMAC-SHA256 signing
  webhook_url TEXT,                     -- for reverse callback
  last_health_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, platform, extension_id)
);

-- 2. Extension-generated events (raw, unprocessed)
CREATE TABLE extension_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  extension_config_id UUID NOT NULL REFERENCES extension_configs(id),
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,              -- 'comment_posted', 'dm_received', 'mention_found'
  extension_user_id TEXT NOT NULL,       -- Extension's view of user on platform
  platform_entity_id TEXT NOT NULL,      -- Post/DM/video ID from platform
  event_payload JSONB NOT NULL,
  signature_verified BOOLEAN DEFAULT FALSE,
  signature_algorithm TEXT,              -- 'hmac-sha256'
  normalized_to_id UUID,                -- Refs engagement_messages.id after normalization
  processing_status TEXT DEFAULT 'pending',  -- 'pending', 'normalized', 'failed'
  processing_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  INDEX idx_extension_events_pending (processing_status) WHERE processing_status = 'pending',
  INDEX idx_extension_events_created (organization_id, created_at DESC)
);

-- 3. Extension commands (action requests FROM extension TO backend)
CREATE TABLE extension_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  extension_config_id UUID NOT NULL REFERENCES extension_configs(id),
  command_type TEXT NOT NULL,            -- 'reply', 'like', 'follow', 'message'
  platform TEXT NOT NULL,
  target_id TEXT NOT NULL,               -- What to act on
  command_payload JSONB NOT NULL,        -- Text to reply, etc
  queued_at TIMESTAMPTZ DEFAULT now(),
  execution_status TEXT DEFAULT 'pending',  -- 'pending', 'executing', 'executed', 'failed'
  executed_at TIMESTAMPTZ,
  platform_response JSONB,
  error_details JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX idx_extension_commands_pending (execution_status) WHERE execution_status = 'pending'
);

-- 4. Track deduplicated sources (prevent double-counting)
CREATE TABLE engagement_message_sources (
  engagement_message_id UUID PRIMARY KEY REFERENCES engagement_messages(id),
  api_source_id TEXT,                   -- From API poll
  extension_event_id UUID REFERENCES extension_events(id),
  source_precedence INT,                -- 1=extension, 2=api (in case of race)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Extension telemetry & analytics
CREATE TABLE extension_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  extension_config_id UUID NOT NULL REFERENCES extension_configs(id),
  event_type TEXT,                      -- 'page_load', 'engagement_action', 'error'
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  INDEX idx_ext_telemetry_org (organization_id, created_at DESC)
);

-- 6. Extension session tokens (for browser auth)
CREATE TABLE extension_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  extension_config_id UUID NOT NULL REFERENCES extension_configs(id),
  session_token TEXT UNIQUE NOT NULL,   -- Secure token
  refresh_token TEXT UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used TIMESTAMPTZ DEFAULT now(),
  INDEX idx_ext_sessions_valid (expires_at) WHERE expires_at > now()
);
```

#### Modified Existing Tables

```sql
-- Add extension columns to engagement_threads
ALTER TABLE engagement_threads
ADD COLUMN IF NOT EXISTS source_origin TEXT DEFAULT 'api',  -- 'api', 'extension', 'webhook'
ADD COLUMN IF NOT EXISTS extension_config_id UUID REFERENCES extension_configs(id);

-- Add extension columns to engagement_messages
ALTER TABLE engagement_messages
ADD COLUMN IF NOT EXISTS source_origin TEXT DEFAULT 'api',
ADD COLUMN IF NOT EXISTS extension_event_id UUID REFERENCES extension_events(id),
ADD COLUMN IF NOT EXISTS extension_config_id UUID REFERENCES extension_configs(id);

-- New indexes for extension lookups
CREATE INDEX idx_engagement_threads_extension
  ON engagement_threads(extension_config_id) WHERE source_origin = 'extension';
CREATE INDEX idx_engagement_messages_extension
  ON engagement_messages(extension_config_id) WHERE source_origin = 'extension';
```

### 8.4 New Endpoints (Option B)

```javascript
// Extension API Routes (behind authentication, rate-limiting)

// 1. INGESTION: Extension sends event
POST /api/extension/events
  Headers: {
    "X-Extension-ID": "ext-123",
    "X-Timestamp": "1234567890",
    "X-Signature": "hmac-sha256=abc123"
  }
  Body: {
    "event_type": "comment_posted|dm_received|mention_found|like_received",
    "platform": "linkedin|youtube",
    "entity_id": "comment-xyz",
    "payload": { /* platform-specific */ }
  }
  Response: {
    "ok": true,
    "event_id": "UUID",
    "normalized_to": "engagement_message_id (or null if not yet normalized)"
  }

// 2. COMMANDS: Backend sends action request to extension
POST /api/extension/commands
  Query: ?organization_id=UUID
  Body: {
    "command_type": "reply|like|follow|message",
    "platform": "linkedin|youtube",
    "target_id": "post-xyz",
    "text": "Your reply here",
    "context": { /* rich context */ }
  }
  Response: {
    "ok": true,
    "command_id": "UUID",
    "queued_for_execution": true
  }

// 3. RESULTS: Extension confirms command execution
POST /api/extension/command-result
  Body: {
    "command_id": "UUID",
    "status": "executed|failed",
    "platform_response": { /* HTTP response from platform */ },
    "error": { /* if failed */ }
  }
  Response: { "ok": true }

// 4. AUTH: Extension session initialization
POST /api/extension/auth/init
  Body: {
    "extension_id": "ext-123",
    "organization_id": "UUID",
    "nonce": "random-string"
  }
  Response: {
    "session_token": "long-random-string",
    "expires_in": 86400,
    "refresh_token": "optional"
  }

// 5. SYNC: Get pending state (for extension recovery)
GET /api/extension/sync
  Query: ?organization_id=UUID&since=2026-03-23T10:00:00Z
  Response: {
    "pending_commands": [ /* commands not yet ack'd */ ],
    "recent_events": [ /* recent inbound events */ ]
  }

// 6. CONFIG: Manage extension per-org settings
GET /api/extension/config
POST /api/extension/config
  Body: {
    "webhook_url": "https://extension-server.com/webhook",
    "capabilities": ["ingest", "commands"],
    "rate_limit": 100
  }
  Response: { /* current config */ }
```

### 8.5 Data Flow (Option B)

```
╔═══════════════════════════════════════════════════════════════════╗
║               CHROME EXTENSION → BACKEND FLOW                     ║
╚═══════════════════════════════════════════════════════════════════╝

1. Extension detects {linked_in_post_with_comment}
   ↓
2. Extension validates extension_config (api_key, webhook_secret)
   ↓
3. Extension calls POST /api/extension/events with HMAC signature
   ↓
4. Backend: extensionWebhookHandler validates signature
   ↓
5. Queue extension event → extension_events table (processing_status='pending')
   ↓
6. extensionEventProcessor worker processes:
   a. Normalize event to engagement_thread + engagement_message
   b. Map extension_user_id → engagement_authors
   c. Handle deduplication (if API already polled this comment)
   d. Store source track in engagement_message_sources
   ↓
7. Existing flow: engagementOpportunityDetectionWorker
   - Scores thread for lead/complaint
   - Triggers AI reply generation
   ↓
8. communityAiActionExecutor queues action
   ↓
9. Command queued in extension_commands (execution_status='pending')
   ↓
10. Extension polls /api/extension/sync (or receives webhook callback)
    ↓
11. Extension receives command: "reply to comment with 'Thanks for...'"
    ↓
12. Extension executes action on platform (browser automation or API)
    ↓
13. Extension posts success/failure to POST /api/extension/command-result
    ↓
14. Backend updates extension_commands.execution_status + platform_response
    ↓
15. Credits deducted, performance tracked


╔═══════════════════════════════════════════════════════════════════╗
║               DEDUPLICATION SCENARIO                              ║
╚═══════════════════════════════════════════════════════════════════╝

Scenario: Comment posted 30 seconds ago
  - Extension sends event immediately (sub-second)
  - API polling job also fetches it 30 seconds later

Solution:
1. Extension event arrives first:
   - Creates engagement_messages row
   - Records in engagement_message_sources (extension_event_id, NOT api_source_id)

2. API polling job fetches later:
   - Checks if platform_message_id already exists in engagement_messages
   - If yes: UPSERT (update metadata only, e.g., like_count, reply_count)
   - Records in engagement_message_sources (api_source_id, extension_event_id)
   - source_precedence=1 (extension wins for timestamps/content)

Result: Single engagement_message row, tracked sources
```

---

## 9. IMPLEMENTATION ROADMAP (Option B)

### Phase 1: Foundation (Week 1-2)
- [ ] Create extension_* tables
- [ ] Build `extensionEventService` (ingest, normalize)
- [ ] Build `extensionSessionService` (auth, token management)
- [ ] Build `extensionSignatureService` (webhook validation)
- [ ] POST /api/extension/events endpoint (basic)
- [ ] Extension event processor worker

**Acceptance Criteria:**
- Extension can send events (raw)
- Backend validates signature
- Events stored in extension_events table
- No normalization yet (testing data model)

### Phase 2: Normalization & Dedup (Week 2-3)
- [ ] Update `engagementNormalizationService` for multi-type support
- [ ] Build platform-specific context tables (LinkedIn, YouTube)
- [ ] Implement deduplication logic
- [ ] Extend engagement_messages table (message_type, source_origin)
- [ ] Extension event processor normalizes → engagement_messages

**Acceptance Criteria:**
- Extension comments appear in engagement_threads
- /api/engagement/* endpoints show extension-sourced messages
- No duplicate message rows from parallel API polling + extension
- Can query "which messages are from extension"

### Phase 3: Commands & Action Flow (Week 3-4)
- [ ] Build `extensionCommandService`
- [ ] Create extension_commands table schema
- [ ] Build extension command processor worker
- [ ] Integrate with communityAiActionExecutor (reuse logic)
- [ ] POST /api/extension/commands endpoint
- [ ] POST /api/extension/command-result endpoint

**Acceptance Criteria:**
- Backend can queue actions for extension
- Extension polls /api/extension/sync and receives commands
- Extension executes actions on platform and reports results
- Credits deducted correctly for extension-initiated replies
- Platform responses stored for audit

### Phase 4: Real-time & Telemetry (Week 4-5)
- [ ] Webhook callback for commands (extension → backend: command results)
- [ ] Extension telemetry collection (events/minute, error rates)
- [ ] Dashboard: extension health & activity
- [ ] Rate limiting per extension config

**Acceptance Criteria:**
- Real-time command execution (<1 second roundtrip)
- Telemetry visible in admin dashboard
- Rate limits enforced per organization

### Phase 5: Extensibility & Safety (Week 5-6)
- [ ] Capability declaration (extension declares what it can do)
- [ ] Risk scoring for extension commands (DM vs. public reply)
- [ ] Approval workflows for high-risk actions
- [ ] Extension versioning & rollout

**Acceptance Criteria:**
- Can restrict certain actions per org/plan
- Audit log of all extension operations
- Safe rollback if extension version is buggy

---

## 10. RISK ANALYSIS

### 10.1 Multi-Tenant Security Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| **Extension leaks org X's data to org Y** | 🟠 Medium | 🔴 Critical | Row-level security policies on all extension_* tables; organization_id in every query |
| **Extension speaks for wrong user** | 🟠 Medium | 🔴 Critical | Validate user_id in extension_sessions before command execution |
| **API key exposed in extension code** | 🔴 High | 🔴 Critical | Never store API key in extension; use session tokens instead. API key only on backend. |
| **Webhook signature forged** | 🟡 Low | 🟠 High | HMAC-SHA256 signature validation; timestamp validation (< 5min old) |
| **Extension version mismatch** | 🟡 Low | 🟡 Medium | Semantic versioning; version in every event header; reject old versions |

### 10.2 Data Quality & Deduplication Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| **Duplicate messages from API + extension** | 🔴 High | 🟡 Medium | engagement_message_sources table; upsert on platform_message_id + thread_id |
| **Race condition: extension + API both write** | 🟡 Medium | 🟡 Medium | Use unique index; last-write-wins with source_precedence |
| **Extension sends stale data** | 🟡 Medium | 🟡 Medium | Timestamp validation; reject events > 5 min old |
| **Platform data inconsistency** | 🟠 Medium | 🟡 Medium | Daily reconciliation job; flag inconsistencies |

### 10.3 Credit & Billing Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| **Extension consumes unlimited credits** | 🟡 Medium | 🟠 High | Rate limiting per extension_config; daily/hourly caps |
| **Credits double-charged (API + extension)** | 🟡 Medium | 🟠 High | Charge only on first engagement_message insert, regardless of source |
| **Extension falsely reports action executed** | 🟡 Low | 🟠 High | Require platform_response verification; spot-check via API polling |

### 10.4 Performance Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| **Event queue backs up during surge** | 🟡 Medium | 🟡 Medium | Scale extensionEventProcessor worker; Redis queue depth monitoring |
| **Deduplication query too slow** | 🟠 Medium | 🟡 Medium | Index on (platform_message_id, thread_id); cache recent IDs |
| **Extension_events table grows unbounded** | 🟠 Medium | 🟠 High | Archive processed events monthly; 90-day retention policy |

---

## 11. SCALABILITY ANALYSIS

### 11.1 Event Throughput

**Assumptions:**
- 1,000 customers × 10 extensions per customer = 10,000 extension instances
- Average: 1 event/minute per extension = 10,000 events/minute
- Peak: 10× = 100,000 events/minute

**Database Capacity:**
- extension_events table: 144M rows/year (10k/min × 1440 min)
- Partitioning by organization_id + created_at (monthly partitions)
- Expected growth: ~1.5 GB/month
- **No issue** with PostgreSQL at this scale

**Queue Capacity:**
- BullMQ on Redis: handles 100k jobs/min easily
- **No issue** with Redis; increase memory if needed

**Extension Polling Load:**
- GET /api/extension/sync every 5 seconds × 10k extensions = 2k req/sec
- **Acceptable** with standard load balancer

### 11.2 Command Execution Latency

**Current:** Commands queued in community_ai_actions; worker processes asynchronously.  
**Target:** < 5 second roundtrip (extension → backend → platform → extension)

**Breakdown:**
- API call: 500ms
- Queue processing: 100ms
- Platform execution: 1-2s
- Extension polling: Up to 5s (if polling every 5s)

**Optimization:**
- Add webhook callback from backend → extension (reduce polling)
- Implement server-sent events (SSE) for real-time commands
- Cache platform API responses to reduce latency

### 11.3 Storage Growth

| Table | Rows/Year | Size/Year | Notes |
|-------|-----------|-----------|-------|
| extension_events | 500M | 50 GB | Archive after 90 days |
| extension_commands | 200M | 20 GB | Archive after 180 days |
| engagement_messages | 1B | 100 GB | Already exists; will grow |
| extension_telemetry | 1B | 50 GB | Can compress/aggregate hourly |

**Recommendation:** Implement partitioning by month + quarterly archive to S3.

---

## 12. INTELLIGENCE LAYER EXTENSION

### 12.1 Extension-Specific Scoring

Add new signal types:
```sql
CREATE TABLE extension_signal_metrics (
  id UUID PRIMARY KEY,
  organization_id UUID,
  message_id UUID REFERENCES engagement_messages(id),
  extension_detected_at TIMESTAMPTZ,   -- Latency vs. API polling
  extension_event_lag_ms INTEGER,      -- Milliseconds behind real-time
  command_latency_ms INTEGER,          -- Response time
  platform_response_time_ms INTEGER,
  extension_user_profile_completeness NUMERIC,  -- % fields captured
  created_at TIMESTAMPTZ
);
```

### 12.2 Authority & Influence

**New capabilities:**
- "Engagement rate when replied via extension vs. API reply"
- "Lead score adjusted for extension user's history"
- "Visibility prediction for extension-originated posts"

**Implementation:** Extend `engagementScoreService` with:
```typescript
async function scoreExtensionEngagement(
  messageId: string,
  extensionConfigId: string
): Promise<EnhancedScore> {
  // 1. Base engagement score
  // 2. Adjustment: extension user history
  // 3. Adjustment: response time (faster = more authentic?)
  // 4. Adjustment: platform-specific metrics
  // Return enhanced score for ranking
}
```

### 12.3 Opportunity Detection for Extension

**New rule types:**
- "Comment from high-authority user (detected via extension)"
- "Urgent question detected in real-time (extension latency advantage)"
- "Competitive mention (YouTube replies showing competitor)"

**Implementation:** Update `engagementOpportunityDetectionWorker`:
```typescript
if (message.source_origin === 'extension') {
  // Apply extension-specific rules
  // These fire faster because we have real-time data
  checkForUrgentQuestions(message);
  checkForCompetitiveMentions(message);
}
```

---

## 13. EXISTING SYSTEMS TO INTEGRATE WITH

### 13.1 RBAC & Access Control

**Current:** `backend/services/rbacService.ts`

Extension actions **MUST** enforce:
- User's role (can they reply on behalf of org?)
- Organization's plan (can they access extensions?)
- Capability gates (are extensions enabled?)

**Implementation:**
```typescript
const EXTENSION_CAPABILITY = {
  CREATE_EXTENSION: 'community_ai:create_extension',
  EXECUTE_COMMANDS: 'community_ai:execute_commands',
  VIEW_EVENTS: 'community_ai:view_events',
  MANAGE_CONFIG: 'community_ai:manage_extension_config',
};

// In extensionCommandService
const hasCapability = await enforceRole({
  req,
  res,
  requiredCapability: EXTENSION_CAPABILITY.EXECUTE_COMMANDS
});
```

### 13.2 Usage Tracking & Metering

**Current:** `backend/services/usageMeterService.ts`

Extension actions logged as:
```typescript
await logUsageEvent({
  organization_id: orgId,
  feature_area: 'engagement',
  action: 'extension_reply',
  credits_consumed: 1,
  metadata: { extension_config_id, platform, ... }
});
```

### 13.3 Audit Logging

**Current:** `backend/services/auditLog.ts` (limited)

Extension actions need comprehensive audit:
```typescript
await recordAuditEvent({
  organization_id: orgId,
  actor: 'extension',
  action: 'command_executed',
  resource_type: 'community_ai_action',
  resource_id: command_id,
  changes: { status: 'pending' → 'executed', platform_response: {...} },
  timestamp: now()
});
```

### 13.4 Notification System

**Current:** `backend/services/communityAiNotificationService.ts`

When extension events appear:
```typescript
await notifyCommunityAi({
  organization_id: orgId,
  title: 'New LinkedIn comment from extension',
  body: 'User "John Doe" commented on your post',
  action_url: `/engagement/threads/${threadId}`,
  severity: 'normal',
  source: 'extension'
});
```

---

## 14. COMPARISON: API POLLING vs. EXTENSION PUSH

### Existing (API Polling)

| Aspect | Current |
|--------|---------|
| **Latency** | 30-60 seconds (cron cycle) |
| **Data types** | Comments, replies only |
| **Message count** | All recent posts fetch (COST: API calls) |
| **Currency** | Stale; user sees old replies |
| **Effort to reply** | Manual load page, write reply |
| **Dedup** | Single-source (API only) |
| **Failure mode** | Missed engagement until next poll |

### Extension (Push-based, Recommended)

| Aspect | System |
|--------|--------|
| **Latency** | < 1 second |
| **Data types** | Comments, DMs, mentions, likes, shares |
| **Message count** | Only new events = lower API cost |
| **Currency** | Real-time suggestions & notifications |
| **Effort to reply** | Inline reply in browser = lower friction |
| **Dedup** | Multi-source merge (extension + API fallback) |
| **Failure mode** | Extension falls back to API polling |

---

## 15. DEPENDENCIES & BLOCKERS

### Hard Blockers
- [ ] All extension_* table migrations deployed
- [ ] Authentication middleware for extension API
- [ ] HMAC signature validation implemented
- [ ] extensionEventProcessor worker ready

### Soft Blockers (can work around)
- [ ] Real-time webhook callback (can fall back to polling)
- [ ] Platform-specific context tables (can use raw JSONB initially)
- [ ] Extension telemetry dashboard (can skip MVP)

---

## 16. TESTING STRATEGY

### 16.1 Unit Tests

```typescript
// Test signature validation
test('rejectInvalidSignature', async () => {
  const event = mockExtensionEvent();
  const signature = 'wrong-signature';
  expect(await verifySignature(event, signature)).toBe(false);
});

// Test deduplication
test('deduplicateExtensionVsAPI', async () => {
  const msgId = 'comment-123';
  await insertExtensionEvent({ platform_message_id: msgId });
  await insertAPIMessage({ platform_message_id: msgId });
  expect(await countMessages(msgId)).toBe(1);  // Only 1 row
});

// Test credit deduction
test('deductCreditsForExtensionReply', async () => {
  const orgId = 'org-1';
  const before = await getBalance(orgId);
  await executeCommand(orgId, { action_type: 'reply' });
  const after = await getBalance(orgId);
  expect(before - after).toBe(1);  // Charged 1 credit
});
```

### 16.2 Integration Tests

```typescript
// End-to-end: Extension event → inbox notification
test('extensionEventAppears InInbox', async () => {
  const ext = await createExtensionConfig(orgId);
  const event = await sendExtensionEvent(ext.api_key, { 
    event_type: 'comment_posted',
    ... 
  });
  await waitForProcessor();
  const threads = await getInboxThreads(orgId);
  expect(threads[0].source_origin).toBe('extension');
});

// End-to-end: Content moderation
test('extensionCommandIsModerated', async () => {
  const cmd = { action_type: 'reply', text: 'Bad word here' };
  const result = await queueCommand(orgId, cmd);
  expect(result.status).toBe('blocked_content_moderation');
});
```

### 16.3 Load Tests

```typescript
// Simulate 10k extensions sending 1 event/sec = 10k events/sec
load_test('extensionEventThroughput', async () => {
  let count = 0;
  for (let i = 0; i < 10_000; i++) {
    sendExtensionEvent(configs[i % 10].api_key, mockEvent());
  }
  await waitForProcessor();
  expect(await countProcessedEvents()).toBeGreaterThan(9_000);  // 90% success
  expect(avgLatency).toBeLessThan(500);  // ms
});
```

---

## 17. ROLLOUT PLAN

### Phase 1: Closed Beta (Week 6-7)
- 5-10 customers
- Manual activation via admin panel
- Detailed monitoring & logging
- Daily sync calls with customer teams

### Phase 2: Open Beta (Week 8-9)
- 100 customers
- Self-serve extension installation
- Automated rollback if error rate > 5%
- Public documentation

### Phase 3: GA (Week 10)
- All customers
- Feature flag for opt-out
- SLA: 99.9% uptime

---

## 18. MIGRATION GUIDE: Existing API→ Extension Integration

### For UI Teams

**Currently:**
```typescript
// Every 60 seconds
GET /api/engagement/threads → renders inbox
```

**After Extension:**
```typescript
// Immediate (WebSocket or polling /api/extension/sync)
GET /api/extension/sync → pushes new events
// Still fetch threads, but with fresher data
GET /api/engagement/threads
```

**UI Changes:**
- Real-time toast notifications for new engagement
- Inline reply box (extension injects UI)
- Source indicator (API vs. extension)

### For Mobile / SDKs

**Option 1:** Use engagement_threads as-is (no SDK changes needed).  
**Option 2:** Expose `/api/extension/sync` for real-time subscriptions.

---

## 19. DOCUMENTATION ARTIFACTS

### Deliverables

1. **Open API Spec** (`/docs/extension-api.openapi.yml`)
   - All 6 extension endpoints
   - Request/response schemas
   - Error codes & meanings

2. **Extension Developer Guide** (`/docs/extension-developer-guide.md`)
   - Setup: get API key, configure webhook
   - Event format & examples
   - Signature validation code samples
   - Troubleshooting

3. **Architecture Decision Record** (`/docs/adr-005-extension-layer.md`)
   - Rationale for Option B
   - Rejected alternatives
   - Trade-offs

4. **Data Dictionary** (`/docs/extension-schema-reference.md`)
   - All tables, columns, types
   - Indexes for query optimization
   - Row-level security policies

---

## 20. SUCCESS METRICS

### Week 1-2 (Foundation)
- [ ] 100% extension events ingested
- [ ] < 5% signature validation failures
- [ ] > 99.9% uptime on /api/extension/events

### Week 3-4 (Normalization)
- [ ] 100% deduplication success (0 duplicate rows)
- [ ] Extension messages visible in inbox
- [ ] Zero data losses in conflict scenarios

### Week 5-6 (Commands)
- [ ] 100% command delivery success
- [ ] < 5 second end-to-end latency (p95)
- [ ] > 98% credit deduction accuracy

### Week 7-8 (Beta)
- [ ] > 90% customer activation rate
- [ ] < 1% support escalations
- [ ] > 95% user satisfaction score

### Week 9-10 (GA)
- [ ] > 50% of customers using extension
- [ ] No regression in existing /api/engagement/* performance
- [ ] 99.9% uptime SLA met

---

## 📌 IMPLEMENTATION CHECKLIST

### Pre-Code
- [ ] Architecture review with team
- [ ] Security review (third-party audit for webhook validation)
- [ ] Database schema approved by DBA
- [ ] API contract signed off by mobile/SDK teams

### Core Implementation
- [ ] Create extension_* tables (16 tables in schema)
- [ ] Build extensionEventService (3 functions)
- [ ] Build extensionSessionService (2 functions)
- [ ] Build extensionSignatureService (1 function)
- [ ] Create 3 extension API routes
- [ ] Create 3 extension workers
- [ ] Update engagement normalization (multi-type support)
- [ ] Add source tracking (engagement_message_sources)

### Integration
- [ ] Hook into communityAiActionExecutor
- [ ] Integrate with creditDeductionService
- [ ] Wire up RBAC checks
- [ ] Add audit logging

### Testing
- [ ] Unit tests (40+ test cases)
- [ ] Integration tests (20+ scenarios)
- [ ] Load tests (10k events/sec)
- [ ] Security tests (signature validation, RLS)

### Documentation
- [ ] OpenAPI spec
- [ ] Developer guide
- [ ] ADR
- [ ] Data dictionary

### Rollout
- [ ] Beta customer signup (5-10)
- [ ] Monitoring dashboards
- [ ] Runbook for on-call
- [ ] Customer training materials

---

## CONCLUSION

**The current Engagement Command Center is 65% ready for Chrome extension integration.** The existing inbox model, AI reply generation, and credit system provide a solid foundation. However, **Option B (Unified Extension Layer) is recommended** to:

1. ✅ Isolate extension events from API polling
2. ✅ Support multi-message formats (DMs, likes, mentions)
3. ✅ Implement real-time event processing
4. ✅ Manage bidirectional communication cleanly
5. ✅ Avoid complex deduplication logic

**Timeline:** 6-10 weeks for full implementation + rollout.

**Risk:** Moderate; key mitigations are signature validation, row-level security, and comprehensive testing.

**ROI:** Massive; real-time engagement = faster response times = happier customers = higher retention.

---

**Document Version:** 1.0  
**Last Updated:** March 23, 2026  
**Next Review:** After Phase 2 Completion (Week 8)

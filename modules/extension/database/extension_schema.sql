/**
 * PostgreSQL Schema for Extension Module
 * 
 * Production-grade schema for Chrome extension integration.
 * Supports event ingestion, command execution, deduplication, and multi-tenant isolation.
 * 
 * Tables:
 * 1. extension_events - Raw events from extension (never edited)
 * 2. extension_commands - Action queue for extension execution
 * 3. extension_sessions - Session tokens & polling config
 * 4. engagement_message_sources - Dedup bridge to engagement_messages
 * 
 * Design Principles:
 * - extension_events are immutable (append-only)
 * - All tables filtered by org_id (multi-tenant)
 * - RLS-compatible for Supabase
 * - Indexes optimized for common queries
 * - Partitioning support for scale
 * 
 * @author Engineering Team
 * @date 2025-Q2
 */

-- ============================================================================
-- TABLE 1: extension_events (RAW INGESTION)
-- ============================================================================
-- 
-- Raw events directly from Chrome extension. Never edited, only inserted.
-- Acts as source-of-truth for all extension activity.
--
-- Key Fields:
-- - platform_message_id: Unique ID from platform (LinkedIn URN, YouTube comment ID, etc.)
-- - source: Always 'extension' (supports future webhook/API sources)
-- - processed: Flag to track which events have been converted to engagement_messages
--
-- Lifecycle:
-- 1. Created when ext receives event
-- 2. extensionEventProcessor reads unprocessed rows
-- 3. Converts to engagement_messages
-- 4. Marks as processed
--
CREATE TABLE IF NOT EXISTS extension_events (
  -- Identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,

  -- Platform metadata
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'youtube')),
  event_type TEXT NOT NULL CHECK (event_type IN ('comment', 'reply', 'dm', 'mention', 'like', 'share')),

  -- CRITICAL for deduplication
  -- Examples:
  -- LinkedIn comment: "urn:li:comment:(activity_id,comment_id)"
  -- YouTube: "googlevideo|video_id|comment_id"
  platform_message_id TEXT NOT NULL,

  -- Raw platform data (unmodified)
  data JSONB NOT NULL,

  -- Source field for unified ingestion
  -- 'extension' = Chrome extension
  -- Future: 'webhook', 'api', 'mobile'
  source TEXT DEFAULT 'extension' CHECK (source IN ('extension', 'webhook', 'api', 'mobile')),

  -- Processing status
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  processing_error TEXT, -- error message if processing fails

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT org_user_valid CHECK (org_id IS NOT NULL AND user_id IS NOT NULL)
);

-- ============================================================================
-- INDEXES: extension_events
-- ============================================================================

-- Deduplication: Ensure only one event per platform_message_id per org
-- Used by worker to check "have we already processed this?"
CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_events_dedup
ON extension_events (org_id, platform, platform_message_id)
WHERE processed = FALSE;

-- Processing: Find unprocessed events for worker
-- Worker query: SELECT * FROM extension_events WHERE processed = FALSE ORDER BY created_at ASC;
CREATE INDEX IF NOT EXISTS idx_extension_events_unprocessed
ON extension_events (processed, created_at DESC);

-- User-scoped queries (for audit, troubleshooting)
CREATE INDEX IF NOT EXISTS idx_extension_events_org_user
ON extension_events (org_id, user_id, created_at DESC);

-- Time-range queries (analytics, cleanup)
CREATE INDEX IF NOT EXISTS idx_extension_events_created
ON extension_events (org_id, created_at DESC);

-- ============================================================================
-- TABLE 2: extension_commands (ACTION QUEUE)
-- ============================================================================
--
-- Actions queued for extension to execute.
-- Extension polls GET /api/extension/commands to fetch pending.
-- Then reports results via POST /api/extension/action-result.
--
-- Lifecycle:
-- 1. Created by backend (e.g., after AI generates reply)
-- 2. Extension fetches pending commands
-- 3. Extension marks as EXECUTING (for safe retries)
-- 4. Extension executes on platform
-- 5. Extension POSTs result → marked SUCCESS/FAILED
--
-- Retry Safety:
-- If network breaks mid-execution:
-- - Status = EXECUTING means "don't re-execute"
-- - Timeout logic: if EXECUTING > 5min, reset to PENDING
--
CREATE TABLE IF NOT EXISTS extension_commands (
  -- Identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,

  -- Target platform & action
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'youtube')),
  action_type TEXT NOT NULL CHECK (action_type IN ('post_reply', 'like', 'follow', 'share', 'dm_reply', 'save')),

  -- Target ID (post, thread, comment, etc.)
  target_id TEXT NOT NULL,

  -- Action payload (reply text, metadata, etc.)
  payload JSONB NOT NULL,

  -- Execution priority
  -- Used to sort pending commands by urgency
  -- HIGH: Urgent customer reply, VIP engagement
  -- MEDIUM: Normal flow
  -- LOW: Bulk back-fill, cleanup tasks
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),

  -- Execution status
  -- pending   → waiting for extension to pick up
  -- executing → extension is active (mid-flight)
  -- success   → completed successfully
  -- failed    → execution failed (retry logic may apply)
  -- cancelled → manually cancelled
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'success', 'failed', 'cancelled')),

  -- Retry tracking
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  last_retry_at TIMESTAMP,

  -- Execution result
  result JSONB, -- { success: bool, platform_response: {...}, error?: string }

  -- Lifecycle timestamps
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  executed_at TIMESTAMP,

  -- Expiry: Command invalid after this time
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days'),

  -- Constraints
  CONSTRAINT org_user_valid CHECK (org_id IS NOT NULL AND user_id IS NOT NULL),
  CONSTRAINT valid_expiry CHECK (expires_at > created_at)
);

-- ============================================================================
-- INDEXES: extension_commands
-- ============================================================================

-- Primary query: Fetch pending commands for user (sorted by priority)
-- Query: SELECT * FROM extension_commands 
--        WHERE user_id = ? AND org_id = ? AND status = 'pending'
--        ORDER BY priority DESC, created_at ASC;
CREATE INDEX IF NOT EXISTS idx_extension_commands_pending
ON extension_commands (user_id, status, priority, created_at)
WHERE status IN ('pending', 'executing');

-- Clean up expired commands
-- Query: DELETE FROM extension_commands WHERE expires_at < NOW();
CREATE INDEX IF NOT EXISTS idx_extension_commands_expired
ON extension_commands (org_id, expires_at)
WHERE status NOT IN ('success', 'failed');

-- Analytics: Commands by status
CREATE INDEX IF NOT EXISTS idx_extension_commands_status
ON extension_commands (org_id, status, created_at DESC);

-- User-scoped queries
CREATE INDEX IF NOT EXISTS idx_extension_commands_user
ON extension_commands (org_id, user_id, created_at DESC);

-- ============================================================================
-- TABLE 3: extension_sessions (AUTH & CONFIG)
-- ============================================================================
--
-- Extension session tokens with polling configuration.
-- Created when extension initializes.
-- Validated on each API request.
--
-- Lifecycle:
-- 1. Extension loads → POST /api/extension/auth → issues token
-- 2. Token stored in extension storage (encrypted)
-- 3. Each request includes: Authorization: Bearer <token>
-- 4. Backend validates against this table
-- 5. On logout → token deleted
--
CREATE TABLE IF NOT EXISTS extension_sessions (
  -- Identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  org_id UUID NOT NULL,

  -- Session token (Bearer token)
  -- Generated as: SHA256(random + timestamp)
  session_token TEXT NOT NULL UNIQUE,

  -- Polling configuration
  sync_mode TEXT DEFAULT 'batch' CHECK (sync_mode IN ('batch', 'real-time', 'hybrid')),
  polling_interval INT DEFAULT 30 CHECK (polling_interval BETWEEN 5 AND 300), -- seconds

  -- Last activity (for cleanup)
  last_seen TIMESTAMP,

  -- Lifecycle timestamps
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

  -- Expiry timestamp
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  -- Constraints
  CONSTRAINT org_user_valid CHECK (org_id IS NOT NULL AND user_id IS NOT NULL),
  CONSTRAINT valid_expiry CHECK (expires_at > created_at)
);

-- ============================================================================
-- INDEXES: extension_sessions
-- ============================================================================

-- Validate token on each request
-- Query: SELECT * FROM extension_sessions WHERE session_token = ? AND expires_at > NOW();
-- Note: WHERE expires_at > NOW() removed - volatile functions not allowed in index predicates
-- Application layer must filter by expires_at at runtime
CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_sessions_token
ON extension_sessions (session_token);

-- Find user's active sessions (for logout, multi-device support)
-- Note: WHERE expires_at > NOW() removed - volatile functions not allowed in index predicates
-- Application layer must filter by expires_at at runtime
CREATE INDEX IF NOT EXISTS idx_extension_sessions_user
ON extension_sessions (org_id, user_id, created_at DESC);

-- Cleanup: Find expired sessions
-- Note: WHERE expires_at < NOW() removed - volatile functions not allowed in index predicates
-- Cleanup job should query: SELECT id FROM extension_sessions WHERE expires_at < NOW() ORDER BY expires_at DESC
CREATE INDEX IF NOT EXISTS idx_extension_sessions_expired
ON extension_sessions (expires_at);

-- ============================================================================
-- TABLE 4: engagement_message_sources (DEDUP BRIDGE) ⭐ CRITICAL
-- ============================================================================
--
-- Maps platform_message_id to engagement_message_id.
-- Enables deduplication when same message arrives from multiple sources.
--
-- Example Problem:
-- - Extension captures comment at 12:00:00
-- - API polling captures same comment at 12:01:00
-- Result: Two entries in engagement_messages (BAD)
--
-- Solution (this table):
-- - Create engagement_messages from source A
-- - Record: { engagement_message_id, source: 'extension', platform_message_id }
-- - At 12:01:00, check: "Does platform_message_id exist?"
-- - YES → skip creating duplicate
--
CREATE TABLE IF NOT EXISTS engagement_message_sources (
  -- Identifiers
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to engagement_messages
  engagement_message_id UUID NOT NULL,

  -- Source origin
  source TEXT NOT NULL CHECK (source IN ('extension', 'api', 'webhook', 'mobile')),

  -- Platform-specific message ID
  platform_message_id TEXT NOT NULL,

  -- Platform (for unique constraint)
  platform TEXT NOT NULL,

  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- ============================================================================
-- INDEXES: engagement_message_sources
-- ============================================================================

-- Dedup check: Does this message already exist?
-- Query: SELECT * FROM engagement_message_sources 
--        WHERE platform_message_id = ? AND platform = ?;
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_source_dedup
ON engagement_message_sources (platform_message_id, platform, source);

-- Find all sources for a message (audit, source history)
CREATE INDEX IF NOT EXISTS idx_message_source_lookup
ON engagement_message_sources (engagement_message_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - Supabase/PostgreSQL
-- ============================================================================
--
-- Ensure users can only see their org's data.
-- Replace 'auth.uid()' and 'auth.org_id()' with your actual functions.
--
-- FOR SUPABASE: auth.uid() returns current user ID
-- YOU MUST ADD: Extension to auth claims or custom function for org_id
--

-- Enable RLS on all tables
ALTER TABLE extension_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_message_sources ENABLE ROW LEVEL SECURITY;

-- extension_events RLS
CREATE POLICY "Users can view own org's events" ON extension_events
  FOR SELECT USING (org_id = (auth.jwt()->>'org_id')::uuid);

CREATE POLICY "Users can insert own org's events" ON extension_events
  FOR INSERT WITH CHECK (org_id = (auth.jwt()->>'org_id')::uuid AND user_id = auth.uid());

-- extension_commands RLS
CREATE POLICY "Users can view own org's commands" ON extension_commands
  FOR SELECT USING (org_id = (auth.jwt()->>'org_id')::uuid);

CREATE POLICY "Users can insert own org's commands" ON extension_commands
  FOR INSERT WITH CHECK (org_id = (auth.jwt()->>'org_id')::uuid AND user_id = auth.uid());

CREATE POLICY "Users can update own commands" ON extension_commands
  FOR UPDATE USING (org_id = (auth.jwt()->>'org_id')::uuid AND user_id = auth.uid());

-- extension_sessions RLS
CREATE POLICY "Users can view own sessions" ON extension_sessions
  FOR SELECT USING (org_id = (auth.jwt()->>'org_id')::uuid AND user_id = auth.uid());

CREATE POLICY "Users can create own sessions" ON extension_sessions
  FOR INSERT WITH CHECK (org_id = (auth.jwt()->>'org_id')::uuid AND user_id = auth.uid());

-- engagement_message_sources RLS
-- Typically managed by workers, not direct user access
CREATE POLICY "Workers can manage message sources" ON engagement_message_sources
  FOR ALL USING (true); -- Service role only, restricted at app layer

-- ============================================================================
-- TRIGGERS: Auto-update updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_extension_events_updated_at
BEFORE UPDATE ON extension_events
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_extension_commands_updated_at
BEFORE UPDATE ON extension_commands
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_extension_sessions_updated_at
BEFORE UPDATE ON extension_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- PARTITIONING STRATEGY (For Scale)
-- ============================================================================
--
-- When extension_events exceeds 10M rows, partition by month:
--
-- ALTER TABLE extension_events PARTITION BY RANGE (DATE_TRUNC('month', created_at));
--
-- CREATE TABLE extension_events_2026_03 PARTITION OF extension_events
--   FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
--
-- Benefits:
-- - Faster cleanup (DROP partition instead of DELETE)
-- - Parallel scans
-- - Easier archival
--

-- ============================================================================
-- JSONB INDEXING (Optional, if needed for specific fields)
-- ============================================================================
--
-- If you frequently query specific fields in data JSONB, add:
--
-- CREATE INDEX idx_extension_events_data_author
-- ON extension_events USING GIN (data jsonb_path_ops);
--
-- Then query: WHERE data @> '{"author":{"name":"John"}}'
--

-- ============================================================================
-- VACUUM & ANALYZE
-- ============================================================================

ANALYZE extension_events;
ANALYZE extension_commands;
ANALYZE extension_sessions;
ANALYZE engagement_message_sources;

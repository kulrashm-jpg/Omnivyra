-- W2-6 — Wave 2 performance DDL batch (Performance Optimization Program).
-- ADDITIVE ONLY: three targeted indexes for the audited hot scans + cleanup
-- of duplicate indexes shipped twice by legacy database/ bootstrap files.
-- No schema redesign, no partitioning, no materialized views, no data change.
--
-- Apply note: statements use plain CREATE INDEX (the migration runner wraps
-- files in a transaction, which forbids CONCURRENTLY). scheduled_posts /
-- credit_transactions are moderate-sized today; if applying against a HOT
-- production table, run the equivalent CREATE INDEX CONCURRENTLY manually
-- via the operator DDL path first — IF NOT EXISTS makes this file a no-op
-- afterwards. Rollback: every statement here is independently DROP-able.

-- 1. Scheduler due-posts scan (audit B-24).
--    Query (backend/scheduler/schedulerService.ts):
--      WHERE status='scheduled' AND scheduled_for<=now
--      ORDER BY priority DESC, scheduled_for ASC LIMIT 100
--    No existing index serves the filter+sort shape; published rows
--    accumulate forever so the scan degrades monotonically without this.
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due_scan
  ON scheduled_posts (priority DESC, scheduled_for ASC)
  WHERE status = 'scheduled';

-- 2. Engagement-polling published-posts scan (audit heat-map query #6).
--    Query (engagementPollingProcessor):
--      WHERE status='published' AND published_at>=cutoff
--      ORDER BY published_at DESC
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_published_scan
  ON scheduled_posts (published_at DESC)
  WHERE status = 'published';

-- 3. Global credit-ledger time ordering (audit B-49).
--    Query (super-admin/global-ledger + keyset pagination foundation):
--      ORDER BY created_at DESC [no org filter in the default path]
--    Existing indexes are all org-/type-prefixed; the bare time ordering
--    walked the heap. Also the backing index for F-11 keyset pagination.
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at
  ON credit_transactions (created_at DESC, id DESC);

-- 4. Duplicate-index cleanup (audit B-51) — write amplification on two
--    write-hot tables + one plan table. Keep the *_id-named variant that the
--    incremental migrations own; drop the legacy bootstrap twins.
--    (IF EXISTS: environments bootstrapped after the legacy files were
--    retired never had them.)
DROP INDEX IF EXISTS idx_scheduled_posts_campaign;      -- dup of idx_scheduled_posts_campaign_id (campaign_id)
DROP INDEX IF EXISTS idx_notifications_user;            -- dup of idx_notifications_user_id (user_id)
DROP INDEX IF EXISTS idx_daily_plans_week;              -- dup of idx_daily_plans_campaign_week (campaign_id, week_number)

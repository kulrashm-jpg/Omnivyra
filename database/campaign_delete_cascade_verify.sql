-- Verify campaign cascade: when campaigns(id) is deleted, related rows are removed
-- Run in Supabase SQL Editor. Idempotent.
-- Use AFTER running twelve_week_plan_status.sql if you added status column.

-- twelve_week_plan already has: REFERENCES campaigns(id) ON DELETE CASCADE
-- If your schema differs, add CASCADE where missing:

-- Example: Ensure twelve_week_plan cascades (usually already set)
-- ALTER TABLE twelve_week_plan DROP CONSTRAINT IF EXISTS twelve_week_plan_campaign_id_fkey;
-- ALTER TABLE twelve_week_plan ADD CONSTRAINT twelve_week_plan_campaign_id_fkey
--   FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

-- No changes needed if tables were created with ON DELETE CASCADE.
-- The delete-campaign API explicitly deletes from all tables before deleting campaigns,
-- so data is removed even if some FKs lack CASCADE.

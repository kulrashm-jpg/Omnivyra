-- Rollback of 20270125000003_engagement_auto_reply_default_off.sql.
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
-- Restores the fail-open default: controls rows inserted without a value enable automatic
-- replies again. No row changes.
ALTER TABLE public.engagement_system_controls ALTER COLUMN auto_reply_enabled SET DEFAULT true;

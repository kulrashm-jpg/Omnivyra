-- Governance (closure C, Mode 3): automatic replies are OFF unless a tenant turns them on.
--
-- NOT APPLIED ANYWHERE. Written for, and tested only on, a disposable test database.
-- Applying it to any real environment needs a separate owner decision.
--
-- `engagement_system_controls.auto_reply_enabled` was created `DEFAULT true NOT NULL`, so
-- every controls row inserted without an explicit value enabled automatic replies. The
-- application now treats only an explicit `true` as on
-- (engagementGovernanceService, closure C commit 1b4d4ce57); this makes the column agree.
--
-- ONLY THE DEFAULT CHANGES. Existing rows are NOT rewritten: a `true` stored by the old
-- default cannot be told apart from a `true` a tenant chose, so turning existing tenants
-- off is an operator decision to be made at apply time, with its own reviewed statement,
-- not something this migration does silently. The other switches on the table keep their
-- defaults. NOT NULL, RLS and grants are untouched.
--
-- Rollback: supabase/migrations/rollbacks/engagement_auto_reply_default_off_rollback.sql

ALTER TABLE public.engagement_system_controls ALTER COLUMN auto_reply_enabled SET DEFAULT false;

-- Migration: add join_source to user_company_roles
-- Tracks how a user joined a company: 'invited' (admin-added) or 'self_joined' (matched on signup)

ALTER TABLE user_company_roles
  ADD COLUMN IF NOT EXISTS join_source TEXT NOT NULL DEFAULT 'invited'
    CHECK (join_source IN ('invited', 'self_joined'));

-- Index for querying self-joined users per company (admin panel)
CREATE INDEX IF NOT EXISTS idx_user_company_roles_join_source
  ON user_company_roles(company_id, join_source)
  WHERE join_source = 'self_joined';

-- Notifications table (if not already created by another migration)
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  metadata      JSONB,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read)
  WHERE is_read = FALSE;

-- Make social_account_id optional on scheduled_posts.
-- Activity-workspace "schedule" creates calendar entries for planning purposes
-- even when no social account is connected yet for that platform.
-- Publishing workers already check for a valid social_account_id before posting.
ALTER TABLE scheduled_posts ALTER COLUMN social_account_id DROP NOT NULL;

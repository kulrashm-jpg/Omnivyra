ALTER TABLE scheduled_posts
ADD COLUMN IF NOT EXISTS execution_intent_id TEXT NULL;

ALTER TABLE scheduled_posts
ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_posts_idempotency_key
  ON scheduled_posts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_execution_intent
  ON scheduled_posts(execution_intent_id);

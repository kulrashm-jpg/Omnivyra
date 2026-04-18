-- WhatsApp Business Integration — Full Schema Migration
-- Safe to run multiple times (all IF NOT EXISTS / idempotent)
-- Incorporates all fixes: Fix A-E + Improvements 1-5

-- ──────────────────────────────────────────────────────────────
-- 1. Extend social_accounts with WhatsApp-specific columns
--    Fix A: added is_system_user for System User Token path
--    Fix B: added auth_client_id_ref, auth_client_secret_ref for
--           getSocialAccountAuthContext() without env coupling
-- ──────────────────────────────────────────────────────────────

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS phone_number_id        TEXT,
  ADD COLUMN IF NOT EXISTS waba_id                TEXT,
  ADD COLUMN IF NOT EXISTS display_phone          TEXT,
  ADD COLUMN IF NOT EXISTS business_account_id    TEXT,
  ADD COLUMN IF NOT EXISTS messaging_tier         INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quality_rating         TEXT,    -- 'green'|'yellow'|'red'
  ADD COLUMN IF NOT EXISTS is_system_user         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auth_client_id_ref     TEXT,    -- env var name or encrypted client_id
  ADD COLUMN IF NOT EXISTS auth_client_secret_ref TEXT;    -- env var name or encrypted client_secret

-- ──────────────────────────────────────────────────────────────
-- 2. Extend engagement_threads
--    Fix D: explicit window columns instead of JSONB-only
-- ──────────────────────────────────────────────────────────────

ALTER TABLE engagement_threads
  ADD COLUMN IF NOT EXISTS social_account_id UUID,
  ADD COLUMN IF NOT EXISTS raw_payload        JSONB       DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS window_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_open        BOOLEAN     DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_eng_threads_window
  ON engagement_threads (window_expires_at)
  WHERE window_open = TRUE;

-- Refinement 3: Inbox UI + conversation history queries
CREATE INDEX IF NOT EXISTS idx_eng_threads_platform_account
  ON engagement_threads (platform, social_account_id);

CREATE INDEX IF NOT EXISTS idx_eng_messages_thread_created
  ON engagement_messages (thread_id, created_at DESC);

-- ──────────────────────────────────────────────────────────────
-- 3. Extend engagement_messages
--    Fix C: unique constraint on (platform, platform_message_id)
--           prevents duplicate webhook inserts atomically
-- ──────────────────────────────────────────────────────────────

ALTER TABLE engagement_messages
  ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS status    TEXT DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;

-- Add unique constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_platform_message'
  ) THEN
    ALTER TABLE engagement_messages
      ADD CONSTRAINT unique_platform_message
      UNIQUE (platform, platform_message_id);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 4. Seed WhatsApp into engagement_sources
-- ──────────────────────────────────────────────────────────────

INSERT INTO engagement_sources (platform, source_type)
VALUES ('whatsapp', 'api')
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 5. WhatsApp Templates
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        REFERENCES companies(id),
  social_account_id UUID        REFERENCES social_accounts(id),
  template_name     TEXT        NOT NULL,
  version           INTEGER     NOT NULL DEFAULT 1,
  is_active         BOOLEAN     NOT NULL DEFAULT FALSE,
  template_category TEXT,
  language_code     TEXT        NOT NULL DEFAULT 'en_US',
  components        JSONB       NOT NULL DEFAULT '[]',
  meta_template_id  TEXT,
  status            TEXT        NOT NULL DEFAULT 'PENDING',
  rejection_reason  TEXT,
  submitted_at      TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  deprecated_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, template_name, version)
);

-- Ensure all columns exist (handles prior partial migration)
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS is_active         BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS version           INTEGER     NOT NULL DEFAULT 1;
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS template_category TEXT;
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS language_code     TEXT        NOT NULL DEFAULT 'en_US';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS components        JSONB       NOT NULL DEFAULT '[]';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS meta_template_id  TEXT;
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS status            TEXT        NOT NULL DEFAULT 'PENDING';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS rejection_reason  TEXT;
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS submitted_at      TIMESTAMPTZ;
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ;
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS deprecated_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wa_templates_company_name
  ON whatsapp_templates (company_id, template_name);

CREATE INDEX IF NOT EXISTS idx_wa_templates_status
  ON whatsapp_templates (status);

-- Partial index: is_active column guaranteed above, use EXECUTE to defer parse
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'whatsapp_templates'
      AND indexname  = 'idx_wa_templates_active'
  ) THEN
    EXECUTE 'CREATE INDEX idx_wa_templates_active
      ON whatsapp_templates (company_id, template_name)
      WHERE is_active = TRUE';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 6. WhatsApp Media Cache
--    Improvement 2: UNIQUE on (company_id, media_hash)
--                   prevents cross-company media leakage
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_media_cache (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        REFERENCES companies(id),
  social_account_id UUID        REFERENCES social_accounts(id),
  media_hash        TEXT        NOT NULL,
  media_id          TEXT        NOT NULL,
  media_type        TEXT        NOT NULL,   -- 'image'|'video'|'document'|'audio'
  source_url        TEXT,
  file_size_bytes   INTEGER,
  expires_at        TIMESTAMPTZ NOT NULL,   -- Meta media IDs expire after 30 days
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (social_account_id, media_hash),
  UNIQUE (company_id, media_hash)           -- Improvement 2: multi-tenant safety
);

CREATE INDEX IF NOT EXISTS idx_wa_media_expires
  ON whatsapp_media_cache (expires_at);

-- Refinement 5: Daily cleanup job target
-- Run: DELETE FROM whatsapp_media_cache WHERE expires_at < NOW();
-- Schedule via pg_cron or application-level cron in backend/queue/

-- ──────────────────────────────────────────────────────────────
-- 7. WhatsApp Broadcasts
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_broadcasts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id),
  social_account_id UUID        NOT NULL REFERENCES social_accounts(id),
  name              TEXT        NOT NULL,
  message_type      TEXT        NOT NULL DEFAULT 'template',
  template_name     TEXT,
  template_params   JSONB       DEFAULT '{}',
  body              TEXT,
  media_id          TEXT,
  media_caption     TEXT,
  status            TEXT        NOT NULL DEFAULT 'draft',
  scheduled_for     TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  total_recipients  INTEGER     DEFAULT 0,
  sent_count        INTEGER     DEFAULT 0,
  delivered_count   INTEGER     DEFAULT 0,
  read_count        INTEGER     DEFAULT 0,
  failed_count      INTEGER     DEFAULT 0,
  created_by        UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_company
  ON whatsapp_broadcasts (company_id, status);

-- Ensure all columns exist (handles prior partial migration)
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS message_type     TEXT        NOT NULL DEFAULT 'template';
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS template_name    TEXT;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS template_params  JSONB       DEFAULT '{}';
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS body             TEXT;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS media_id         TEXT;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS media_caption    TEXT;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS status           TEXT        NOT NULL DEFAULT 'draft';
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS scheduled_for    TIMESTAMPTZ;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS total_recipients INTEGER     DEFAULT 0;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS sent_count       INTEGER     DEFAULT 0;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS delivered_count  INTEGER     DEFAULT 0;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS read_count       INTEGER     DEFAULT 0;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS failed_count     INTEGER     DEFAULT 0;
ALTER TABLE whatsapp_broadcasts ADD COLUMN IF NOT EXISTS created_by       UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'whatsapp_broadcasts'
      AND indexname  = 'idx_wa_broadcasts_status_scheduled'
  ) THEN
    EXECUTE 'CREATE INDEX idx_wa_broadcasts_status_scheduled
      ON whatsapp_broadcasts (scheduled_for)
      WHERE status = ''scheduled''';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 8. WhatsApp Broadcast Recipients
--    Fix E: hashed_phone + encrypted_phone only (no plain contact_wa_id)
--    Improvement 1: ON CONFLICT DO NOTHING handled via unique wa_message_id
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_broadcast_recipients (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id    UUID        NOT NULL REFERENCES whatsapp_broadcasts(id) ON DELETE CASCADE,
  hashed_phone    TEXT        NOT NULL,   -- HMAC-SHA256(e164, PHONE_HASH_SALT)
  encrypted_phone TEXT        NOT NULL,   -- AES-256-GCM encrypted E.164
  contact_name    TEXT,
  wa_message_id   TEXT        UNIQUE,     -- returned by Graph API; NULL until sent
  status          TEXT        DEFAULT 'pending',
  error_code      INTEGER,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  retry_count     INTEGER     DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent duplicate recipients within same broadcast
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_broadcast_recipient'
  ) THEN
    ALTER TABLE whatsapp_broadcast_recipients
      ADD CONSTRAINT unique_broadcast_recipient
      UNIQUE (broadcast_id, hashed_phone);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wa_recipients_broadcast
  ON whatsapp_broadcast_recipients (broadcast_id);

CREATE INDEX IF NOT EXISTS idx_wa_recipients_status
  ON whatsapp_broadcast_recipients (broadcast_id, status);

CREATE INDEX IF NOT EXISTS idx_wa_recipients_hashed_phone
  ON whatsapp_broadcast_recipients (hashed_phone);

CREATE INDEX IF NOT EXISTS idx_wa_recipients_retry
  ON whatsapp_broadcast_recipients (next_retry_at)
  WHERE status = 'failed' AND retry_count < 3;

-- ──────────────────────────────────────────────────────────────
-- Verify
-- ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'whatsapp_templates',
    'whatsapp_media_cache',
    'whatsapp_broadcasts',
    'whatsapp_broadcast_recipients'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      RAISE NOTICE 'OK: % exists', t;
    ELSE
      RAISE WARNING 'MISSING: %', t;
    END IF;
  END LOOP;

  -- Verify critical columns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='social_accounts' AND column_name='is_system_user') THEN
    RAISE NOTICE 'OK: social_accounts.is_system_user exists';
  ELSE
    RAISE WARNING 'MISSING: social_accounts.is_system_user';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='engagement_threads' AND column_name='window_expires_at') THEN
    RAISE NOTICE 'OK: engagement_threads.window_expires_at exists';
  ELSE
    RAISE WARNING 'MISSING: engagement_threads.window_expires_at';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='unique_platform_message') THEN
    RAISE NOTICE 'OK: unique_platform_message constraint exists';
  ELSE
    RAISE WARNING 'MISSING: unique_platform_message constraint';
  END IF;
END $$;

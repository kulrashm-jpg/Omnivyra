-- ─────────────────────────────────────────────────────────────────────────────
-- Earn-more credits system
-- Tables: earn_credit_actions, referrals, feedback_submissions,
--         company_setup_progress
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Log of every earn-more credit grant (prevents double-granting)
CREATE TABLE IF NOT EXISTS earn_credit_actions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL,
  user_id         UUID        NOT NULL,
  action_type     TEXT        NOT NULL,
    -- 'referral_signup' | 'feedback_approved' | 'setup_complete'
    -- | 'website_connected' | 'first_campaign_published'
  credits_granted INTEGER     NOT NULL,
  reference_id    TEXT        NOT NULL,   -- dedupe key per action
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, action_type, reference_id)
);

-- 2. Referrals — track who invited whom
CREATE TABLE IF NOT EXISTS referrals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID        NOT NULL,
  referrer_org_id  UUID        NOT NULL,
  referral_code    TEXT        NOT NULL,
  invited_email    TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'completed'
  referee_user_id  UUID,
  referee_org_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  UNIQUE (referral_code, invited_email)
);

CREATE INDEX IF NOT EXISTS referrals_code_idx ON referrals (referral_code);

-- 3. Feedback submissions — reviewed by super admin
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  organization_id UUID        NOT NULL,
  feedback_text   TEXT        NOT NULL,
  rating          INTEGER     CHECK (rating BETWEEN 1 AND 5),
  status          TEXT        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'rejected'
  credits_granted BOOLEAN     NOT NULL DEFAULT FALSE,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID
);

CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback_submissions (status);

-- 4. Per-company setup checklist (tracks sub-steps for earn actions)
CREATE TABLE IF NOT EXISTS company_setup_progress (
  company_id                UUID        PRIMARY KEY,
  profile_complete          BOOLEAN     NOT NULL DEFAULT FALSE,
  external_api_connected    BOOLEAN     NOT NULL DEFAULT FALSE,
  social_accounts_connected BOOLEAN     NOT NULL DEFAULT FALSE,
  website_blog_connected    BOOLEAN     NOT NULL DEFAULT FALSE,
  lead_capture_connected    BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

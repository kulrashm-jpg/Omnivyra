-- =============================================================================
-- Free Credits Schema
-- Tracks users who came through the "Get Free Credits" onboarding flow.
-- These users are stored separately for targeted marketing campaigns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. free_credit_profiles
--    One row per free-credits user. Phone number is unique — prevents
--    one person from claiming free credits multiple times via different emails.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS free_credit_profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id     uuid,                         -- populated after org creation
  phone_number        text        UNIQUE NOT NULL,   -- E.164 format, e.g. +447911123456
  phone_verified_at   timestamptz NOT NULL DEFAULT now(),
  firebase_uid        text,                          -- Firebase UID from phone auth

  -- Intent data from onboarding questionnaire
  intent_goals        text[]      NOT NULL DEFAULT '{}',   -- Q1 answers
  intent_team         text,                                 -- Q2 answer
  intent_challenges   text[]      NOT NULL DEFAULT '{}',   -- Q3 answers

  -- Credit tracking
  acquisition_source  text        NOT NULL DEFAULT 'get_free_credits',
  initial_credits     integer     NOT NULL DEFAULT 300,
  credit_expiry_at    timestamptz NOT NULL DEFAULT (now() + interval '14 days'),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fcp_user_id   ON free_credit_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_fcp_phone     ON free_credit_profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_fcp_org_id    ON free_credit_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_fcp_created   ON free_credit_profiles(created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. free_credit_claims
--    Append-only. One row per category per user.
--    UNIQUE(user_id, category) enforces "claim once per category" at DB level.
--
--    Categories:
--      'initial'         — 300 credits on phone verification
--      'invite_friend'   — +200 credits
--      'feedback'        — +100 credits
--      'setup'           — +100 credits (profile completed)
--      'connect_social'  — +150 credits (social/website connected)
--      'first_campaign'  — +200 credits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS free_credit_claims (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid,
  category        text        NOT NULL,
  credits_granted integer     NOT NULL,
  claimed_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT free_credit_claims_user_category UNIQUE (user_id, category),
  CONSTRAINT free_credit_claims_positive_credits CHECK (credits_granted > 0)
);

CREATE INDEX IF NOT EXISTS idx_fcc_user_id        ON free_credit_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_fcc_user_category  ON free_credit_claims(user_id, category);
CREATE INDEX IF NOT EXISTS idx_fcc_claimed_at     ON free_credit_claims(claimed_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Trigger: auto-update updated_at on free_credit_profiles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_free_credit_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fcp_updated_at ON free_credit_profiles;
CREATE TRIGGER trg_fcp_updated_at
  BEFORE UPDATE ON free_credit_profiles
  FOR EACH ROW EXECUTE FUNCTION update_free_credit_profile_timestamp();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE free_credit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_credit_claims   ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile
CREATE POLICY fcp_select_own ON free_credit_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY fcp_update_own ON free_credit_profiles FOR UPDATE USING (auth.uid() = user_id);

-- Users can read their own claims
CREATE POLICY fcc_select_own ON free_credit_claims FOR SELECT USING (auth.uid() = user_id);

-- Service role (server-side API) bypasses RLS

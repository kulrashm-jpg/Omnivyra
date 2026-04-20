CREATE TABLE IF NOT EXISTS engagement_platform_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT engagement_platform_preferences_platform_check CHECK (char_length(trim(platform)) > 0),
  CONSTRAINT engagement_platform_preferences_unique UNIQUE (company_id, user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_engagement_platform_preferences_company_user
  ON engagement_platform_preferences(company_id, user_id);

CREATE INDEX IF NOT EXISTS idx_engagement_platform_preferences_company_platform
  ON engagement_platform_preferences(company_id, platform);

-- ============================================================================
-- Migration: User Preferences Table
-- Description: Stores user UI preferences (landing page, command center pinning)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Command center preferences
  default_landing VARCHAR(50) DEFAULT 'command_center', -- 'command_center' or 'dashboard'
  command_center_pinned BOOLEAN DEFAULT TRUE, -- TRUE = show command center, FALSE = skip to dashboard
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_user_id UNIQUE(user_id),
  CONSTRAINT valid_default_landing CHECK (default_landing IN ('command_center', 'dashboard'))
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id 
  ON public.user_preferences(user_id);

-- Enable RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "users_can_view_own_preferences" ON public.user_preferences;
CREATE POLICY "users_can_view_own_preferences"
  ON public.user_preferences FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_can_update_own_preferences" ON public.user_preferences;
CREATE POLICY "users_can_update_own_preferences"
  ON public.user_preferences FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_can_insert_own_preferences" ON public.user_preferences;
CREATE POLICY "users_can_insert_own_preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Service role can manage all
DROP POLICY IF EXISTS "service_role_manage_preferences" ON public.user_preferences;
CREATE POLICY "service_role_manage_preferences"
  ON public.user_preferences 
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

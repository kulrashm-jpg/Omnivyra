ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS report_settings JSONB DEFAULT '{}'::jsonb;

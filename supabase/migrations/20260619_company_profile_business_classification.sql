ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS business_classification JSONB;

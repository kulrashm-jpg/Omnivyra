ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS favicon_url TEXT;

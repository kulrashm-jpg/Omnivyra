ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS pinterest_url TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_url TEXT;

DO $$
BEGIN

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'active_lead_automation_settings'
  ) THEN

    CREATE TABLE public.active_lead_automation_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      company_id uuid NOT NULL,

      is_enabled boolean NOT NULL DEFAULT false,

      created_at timestamp with time zone DEFAULT now(),
      updated_at timestamp with time zone DEFAULT now()
    );

  END IF;

END $$;
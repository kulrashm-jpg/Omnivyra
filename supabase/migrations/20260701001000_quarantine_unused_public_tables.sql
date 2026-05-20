-- Parks empty, unreferenced public tables in an archive schema.
-- This is intentionally reversible and does not drop data.

BEGIN;

CREATE SCHEMA IF NOT EXISTS archive;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'active_lead_automation_settings',
    'active_lead_memory',
    'intelligence_daily_aggregates',
    'intelligence_gaps',
    'intelligence_prompt_responses',
    'intelligence_prompts',
    'scheduled_posts_execution_intent',
    'whatsapp_conversations',
    'whatsapp_messages'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA archive', t);
      EXECUTE format(
        'COMMENT ON TABLE archive.%I IS %L',
        t,
        'Quarantined from public schema on 2026-07-01 migration 20260701001000 after local code/reference scan found no runtime usage and exact row count was zero.'
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

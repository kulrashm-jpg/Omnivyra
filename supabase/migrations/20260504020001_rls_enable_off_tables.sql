-- Phase D — RLS Governance Fix (Migration 1 of 2) — REPLAY-SAFE VERSION
--
-- For each of the 34 tables that have RLS=OFF in prod, this migration:
--   1. Enables RLS on the table (only if the table exists),
--   2. Adds a service_role_all policy (only if not already present).
--
-- TABLE-EXISTENCE GUARD: every operation is wrapped in a DO block that checks
-- information_schema.tables first. On a clean-DB replay where most prod
-- tables are not yet in canonical (335 missing per Phase E drift report),
-- this migration becomes a no-op for absent tables instead of crashing with
-- "relation does not exist".
--
-- Once Phase E2..E7 import the missing tables, the same migration will
-- automatically start applying the RLS pair to the newly-present tables on
-- the next replay (no re-edit required).
--
-- The pattern below is repeated 34× for clarity. Each block is independent;
-- one table failing wouldn't affect the others (though IF-EXISTS makes
-- failure impossible).

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='active_lead_automation_settings') THEN
    EXECUTE 'ALTER TABLE public.active_lead_automation_settings ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_lead_automation_settings' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.active_lead_automation_settings FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='active_lead_memory') THEN
    EXECUTE 'ALTER TABLE public.active_lead_memory ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_lead_memory' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.active_lead_memory FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='active_lead_runs') THEN
    EXECUTE 'ALTER TABLE public.active_lead_runs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_lead_runs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.active_lead_runs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='active_leads') THEN
    EXECUTE 'ALTER TABLE public.active_leads ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_leads' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.active_leads FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='canonical_backlink_signals') THEN
    EXECUTE 'ALTER TABLE public.canonical_backlink_signals ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='canonical_backlink_signals' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.canonical_backlink_signals FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_llm_configs') THEN
    EXECUTE 'ALTER TABLE public.company_llm_configs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_llm_configs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.company_llm_configs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_setup_progress') THEN
    EXECUTE 'ALTER TABLE public.company_setup_progress ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_setup_progress' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.company_setup_progress FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='creator_execution_audit_logs') THEN
    EXECUTE 'ALTER TABLE public.creator_execution_audit_logs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_audit_logs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.creator_execution_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='creator_execution_dead_letter_queue') THEN
    EXECUTE 'ALTER TABLE public.creator_execution_dead_letter_queue ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_dead_letter_queue' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.creator_execution_dead_letter_queue FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='creator_execution_metrics') THEN
    EXECUTE 'ALTER TABLE public.creator_execution_metrics ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_metrics' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.creator_execution_metrics FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='creator_execution_summaries') THEN
    EXECUTE 'ALTER TABLE public.creator_execution_summaries ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_summaries' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.creator_execution_summaries FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='creator_template_registry') THEN
    EXECUTE 'ALTER TABLE public.creator_template_registry ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_template_registry' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.creator_template_registry FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='decision_priority_queue') THEN
    EXECUTE 'ALTER TABLE public.decision_priority_queue ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='decision_priority_queue' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.decision_priority_queue FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='earn_credit_actions') THEN
    EXECUTE 'ALTER TABLE public.earn_credit_actions ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='earn_credit_actions' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.earn_credit_actions FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='external_api_assignments') THEN
    EXECUTE 'ALTER TABLE public.external_api_assignments ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='external_api_assignments' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.external_api_assignments FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='external_api_connections') THEN
    EXECUTE 'ALTER TABLE public.external_api_connections ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='external_api_connections' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.external_api_connections FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='external_api_usage_logs') THEN
    EXECUTE 'ALTER TABLE public.external_api_usage_logs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='external_api_usage_logs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.external_api_usage_logs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='feedback_submissions') THEN
    EXECUTE 'ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feedback_submissions' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.feedback_submissions FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='llm_models') THEN
    EXECUTE 'ALTER TABLE public.llm_models ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='llm_models' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.llm_models FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='llm_providers') THEN
    EXECUTE 'ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='llm_providers' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.llm_providers FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='market_pulse_automation_settings') THEN
    EXECUTE 'ALTER TABLE public.market_pulse_automation_settings ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_automation_settings' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.market_pulse_automation_settings FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='market_pulse_findings') THEN
    EXECUTE 'ALTER TABLE public.market_pulse_findings ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_findings' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.market_pulse_findings FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='market_pulse_memory') THEN
    EXECUTE 'ALTER TABLE public.market_pulse_memory ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_memory' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.market_pulse_memory FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='market_pulse_runs') THEN
    EXECUTE 'ALTER TABLE public.market_pulse_runs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_runs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.market_pulse_runs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='post_analytics_polls') THEN
    EXECUTE 'ALTER TABLE public.post_analytics_polls ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_analytics_polls' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.post_analytics_polls FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='referrals') THEN
    EXECUTE 'ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='referrals' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.referrals FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='report_automation_configs') THEN
    EXECUTE 'ALTER TABLE public.report_automation_configs ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='report_automation_configs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.report_automation_configs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='report_automation_events') THEN
    EXECUTE 'ALTER TABLE public.report_automation_events ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='report_automation_events' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.report_automation_events FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_broadcast_recipients') THEN
    EXECUTE 'ALTER TABLE public.whatsapp_broadcast_recipients ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_broadcast_recipients' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.whatsapp_broadcast_recipients FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_broadcasts') THEN
    EXECUTE 'ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_broadcasts' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.whatsapp_broadcasts FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_conversations') THEN
    EXECUTE 'ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_conversations' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.whatsapp_conversations FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_media_cache') THEN
    EXECUTE 'ALTER TABLE public.whatsapp_media_cache ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_media_cache' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.whatsapp_media_cache FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_messages') THEN
    EXECUTE 'ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_messages' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.whatsapp_messages FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_templates') THEN
    EXECUTE 'ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_templates' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.whatsapp_templates FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

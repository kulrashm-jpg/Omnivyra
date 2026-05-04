-- Phase D — RLS Governance Fix (Migration 1 of 2)
--
-- Enables ROW LEVEL SECURITY on 34 public.* tables that currently have it OFF,
-- AND in the SAME migration adds a `service_role_all` policy. The pair is
-- intentional: enabling RLS without a matching policy would lock the table out
-- of any non-service-role client (and even some service paths could mis-route
-- in a window between two migrations).
--
-- Pattern:
--   ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
--   DO $$ BEGIN
--     IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE …) THEN
--       CREATE POLICY "service_role_all" ON public.<t>
--         FOR ALL TO service_role USING (true) WITH CHECK (true);
--     END IF;
--   END $$;
--
-- All 34 tables have been audited (see supabase/_snapshot/rls_classification.md).
-- This is the conservative baseline; future Phase D2 will layer user-scoped
-- policies for the company/user-keyed tables.

-- Helper macro (PL/pgSQL pattern repeated below — single block per table for clarity)

ALTER TABLE public.active_lead_automation_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_lead_automation_settings' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.active_lead_automation_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.active_lead_memory ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_lead_memory' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.active_lead_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.active_lead_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_lead_runs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.active_lead_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.active_leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='active_leads' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.active_leads FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.canonical_backlink_signals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='canonical_backlink_signals' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.canonical_backlink_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.company_llm_configs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_llm_configs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.company_llm_configs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.company_setup_progress ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_setup_progress' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.company_setup_progress FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.creator_execution_audit_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_audit_logs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.creator_execution_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.creator_execution_dead_letter_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_dead_letter_queue' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.creator_execution_dead_letter_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.creator_execution_metrics ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_metrics' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.creator_execution_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.creator_execution_summaries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_execution_summaries' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.creator_execution_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.creator_template_registry ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='creator_template_registry' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.creator_template_registry FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.decision_priority_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='decision_priority_queue' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.decision_priority_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.earn_credit_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='earn_credit_actions' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.earn_credit_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.external_api_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='external_api_assignments' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.external_api_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.external_api_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='external_api_connections' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.external_api_connections FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.external_api_usage_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='external_api_usage_logs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.external_api_usage_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feedback_submissions' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.feedback_submissions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.llm_models ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='llm_models' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.llm_models FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.llm_providers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='llm_providers' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.llm_providers FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.market_pulse_automation_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_automation_settings' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.market_pulse_automation_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.market_pulse_findings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_findings' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.market_pulse_findings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.market_pulse_memory ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_memory' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.market_pulse_memory FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.market_pulse_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_pulse_runs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.market_pulse_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.post_analytics_polls ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_analytics_polls' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.post_analytics_polls FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='referrals' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.referrals FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.report_automation_configs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='report_automation_configs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.report_automation_configs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.report_automation_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='report_automation_events' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.report_automation_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.whatsapp_broadcast_recipients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_broadcast_recipients' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.whatsapp_broadcast_recipients FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_broadcasts' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.whatsapp_broadcasts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_conversations' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.whatsapp_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.whatsapp_media_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_media_cache' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.whatsapp_media_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_messages' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.whatsapp_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_templates' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.whatsapp_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

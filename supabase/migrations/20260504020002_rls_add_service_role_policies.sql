-- Phase D — RLS Governance Fix (Migration 2 of 2) — REPLAY-SAFE VERSION
--
-- For each of the 16 tables that have RLS=ON but 0 policies in prod, add a
-- service_role_all policy. Each statement is wrapped in a DO block that:
--   1. Skips if the table doesn't exist (clean-DB replay safety),
--   2. Skips if the policy already exists (re-apply safety).
--
-- See sibling migration 20260504020001_rls_enable_off_tables.sql for the
-- 34-table RLS-enable pass.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='analytics_integrations') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_integrations' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.analytics_integrations FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='analytics_properties') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_properties' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.analytics_properties FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='analytics_provider_config') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_provider_config' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.analytics_provider_config FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='analytics_tokens') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_tokens' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.analytics_tokens FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='api_idempotency_keys') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='api_idempotency_keys' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.api_idempotency_keys FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_blog_comments') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_comments' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.company_blog_comments FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_blog_relationships') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_relationships' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.company_blog_relationships FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_blog_series') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_series' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.company_blog_series FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='company_blog_series_posts') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_series_posts' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.company_blog_series_posts FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='contacts') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.contacts FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='credit_admin_grants') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='credit_admin_grants' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.credit_admin_grants FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='email_jobs') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='email_jobs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.email_jobs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='engagement_platform_preferences') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_platform_preferences' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.engagement_platform_preferences FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='intelligence_actions') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='intelligence_actions' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.intelligence_actions FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_signals') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lead_signals' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.lead_signals FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='super_admin_audit_logs') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='super_admin_audit_logs' AND policyname='service_role_all') THEN
      EXECUTE 'CREATE POLICY "service_role_all" ON public.super_admin_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;

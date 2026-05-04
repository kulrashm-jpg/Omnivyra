-- Phase D — RLS Governance Fix (Migration 2 of 2)
--
-- Adds the `service_role_all` baseline policy to 16 tables that already have
-- RLS enabled but no policies (effective lockout for non-service-role today).
-- This makes the access intent explicit and aligns with the dominant prod
-- pattern (240 tables already use this exact policy).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_integrations' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.analytics_integrations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_properties' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.analytics_properties FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_provider_config' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.analytics_provider_config FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='analytics_tokens' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.analytics_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='api_idempotency_keys' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.api_idempotency_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_comments' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.company_blog_comments FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_relationships' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.company_blog_relationships FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_series' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.company_blog_series FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_blog_series_posts' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.company_blog_series_posts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contacts' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.contacts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='credit_admin_grants' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.credit_admin_grants FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='email_jobs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.email_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='engagement_platform_preferences' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.engagement_platform_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='intelligence_actions' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.intelligence_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='lead_signals' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.lead_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='super_admin_audit_logs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON public.super_admin_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

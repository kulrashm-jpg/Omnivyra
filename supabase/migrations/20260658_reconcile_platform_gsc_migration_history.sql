DO $$
BEGIN
  IF to_regclass('public.platform_gsc_sync_status') IS NULL THEN
    RAISE EXCEPTION 'Missing public.platform_gsc_sync_status. Apply 20260655_super_admin_omnivyra_gsc.sql before this reconciliation migration.';
  END IF;

  IF to_regclass('public.platform_gsc_daily_metrics') IS NULL THEN
    RAISE EXCEPTION 'Missing public.platform_gsc_daily_metrics. Apply 20260655_super_admin_omnivyra_gsc.sql before this reconciliation migration.';
  END IF;

  IF to_regclass('public.platform_gsc_query_metrics') IS NULL THEN
    RAISE EXCEPTION 'Missing public.platform_gsc_query_metrics. Apply 20260655_super_admin_omnivyra_gsc.sql before this reconciliation migration.';
  END IF;
END $$;

COMMENT ON TABLE public.platform_gsc_sync_status IS
  'Centralized Omnivyra platform Search Console sync status. Reconciled into migration history by 20260658 without rewriting canonical data.';

COMMENT ON TABLE public.platform_gsc_daily_metrics IS
  'Centralized Omnivyra platform Search Console daily aggregates. Reconciled into migration history by 20260658 without rewriting canonical data.';

COMMENT ON TABLE public.platform_gsc_query_metrics IS
  'Centralized Omnivyra platform Search Console query/page/country/device metrics. Reconciled into migration history by 20260658 without rewriting canonical data.';

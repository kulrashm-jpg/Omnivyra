-- 20270217000037_ops_alert_markers  (e1, 2026-11-13; owner ruling P2 limiter outage; review: virality-05;
-- version reserved by virality-83, registry a8157d671)
--
-- Cross-instance, Redis-FREE dedupe for operational alerts (backend/services/opsAlertService.ts). When the signup
-- rate limiter's Redis/Upstash is unreachable, signup fails closed and the owner is emailed - at most once per
-- 30-minute bucket and at most 2 per rolling hour, across ALL instances. Redis is what is down, so the dedupe lives
-- here: the first INSERT of (alert_kind, bucket) wins (PRIMARY KEY); 23505 = already sent for that window.
-- Holds NO tenant data and NO user data - only an alert kind, a time-bucket id and when it was sent.
-- Access: service_role only (INSERT + SELECT). A new table otherwise inherits Supabase default grants, so every
-- privilege is revoked first and the postcondition asserts the result.

CREATE TABLE IF NOT EXISTS public.ops_alert_markers (
  alert_kind text        NOT NULL,
  bucket     text        NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_kind, bucket)
);

ALTER TABLE public.ops_alert_markers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ops_alert_markers FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT ON TABLE public.ops_alert_markers TO service_role;

COMMENT ON TABLE public.ops_alert_markers IS
  'Redis-free cross-instance dedupe for operational alerts (opsAlertService): one row per alert kind per time bucket. No tenant or user data. service_role INSERT/SELECT only.';

DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.ops_alert_markers', 'SELECT')
     OR has_table_privilege('anon', 'public.ops_alert_markers', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ops_alert_markers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ops_alert_markers', 'INSERT') THEN
    RAISE EXCEPTION 'ops_alert_markers is reachable by a client role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ops_alert_markers', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.ops_alert_markers', 'SELECT') THEN
    RAISE EXCEPTION 'ops_alert_markers: service_role lacks INSERT/SELECT';
  END IF;
  IF has_table_privilege('service_role', 'public.ops_alert_markers', 'UPDATE')
     OR has_table_privilege('service_role', 'public.ops_alert_markers', 'DELETE') THEN
    RAISE EXCEPTION 'ops_alert_markers: service_role must not UPDATE/DELETE';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ops_alert_markers'::regclass) THEN
    RAISE EXCEPTION 'ops_alert_markers: RLS not enabled';
  END IF;
END
$verify$;

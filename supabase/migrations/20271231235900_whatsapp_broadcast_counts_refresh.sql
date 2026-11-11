-- WhatsApp broadcast counts, recomputed from the recipient rows (PLACEHOLDER VERSION -
-- to be renamed to 83's reservation).
--
-- THE DEFECT THIS CLOSES (C10, 2026-11-11). processBatch called
-- rpc('increment_broadcast_counts') and the delivery webhook rpc('increment_broadcast_stat');
-- neither function exists in any environment and both results were discarded. So every
-- broadcast's sent/delivered/read/failed counts stayed 0 - the analytics API
-- (pages/api/analytics/whatsapp/broadcasts.ts) and the broadcasts page showed zeros and 0%
-- rates - and no broadcast ever reached 'completed'.
--
-- THE REPLACEMENT is not an increment. The recipient rows are the truth (send-once claim,
-- guarded exits and the forward-only webhook keep them exact); increments double-count on
-- any replay and drift. whatsapp_refresh_broadcast_counts RECOMPUTES the counts from the
-- rows in one statement, so it is idempotent and self-healing: any later call corrects any
-- earlier miss, and old broadcasts are backfilled on their next refresh.
--
--   sent      = sent + delivered + read         (the provider accepted it)
--   failed    = failed + blocked_governance + blocked_send_control
--   open      = pending + sending                (still to resolve)
--   uncertain = send_uncertain                   (outcome unknown)
--   total     = every recipient row
-- INVARIANT (05): total = sent + failed + open + uncertain - those FOUR partition the
-- recipients. PRECONDITION: it holds for rows with counts_refreshed_at IS NOT NULL. The
-- counts were never computed before this migration, so a pre-existing row reads
-- total_recipients = N with every count 0 until its first refresh; counts_refreshed_at
-- NULL means "never computed", NOT "zero". delivered_count (delivered + read) and read_count (read) are SUBSETS of
-- sent_count, reported separately for the delivery funnel; they are NOT addends, so the
-- five columns do not sum to the total. On a completed broadcast open = 0, so
-- uncertain_count is exactly the number of sends whose outcome nobody knows.
-- EXHAUSTIVENESS: a recipient status in none of the four buckets RAISES, naming it, so a
-- new status is caught where it appears instead of as a sum that silently stops holding.
--
-- COMPLETION: a broadcast in 'running' becomes 'completed' (completed_at set once) when no
-- recipient is pending or sending. Only from 'running' - a 'paused', 'draft' or
-- 'scheduled' broadcast is never completed.
--
-- DEBOUNCE (e9): the delivery webhook may refresh once per message on a large broadcast.
-- With p_min_interval_seconds > 0 a refresh within that window of the last one is
-- DEFERRED: it only marks counts_dirty. Batch ends refresh unconditionally, and readers
-- refresh dirty broadcasts before they read, so a deferred refresh is never lost.
-- The recompute reads idx_wa_recipients_status (broadcast_id, status), asserted below.
--
-- PRIVILEGES: SECURITY INVOKER, search_path pinned, EXECUTE service_role only; the grants it
-- needs are stated explicitly (service_role only, never flagged).

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.whatsapp_broadcasts') IS NULL OR to_regclass('public.whatsapp_broadcast_recipients') IS NULL THEN
    RAISE EXCEPTION 'WBC preflight: whatsapp_broadcasts / whatsapp_broadcast_recipients missing';
  END IF;
END
$preflight$;

ALTER TABLE public.whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS counts_refreshed_at timestamptz;
ALTER TABLE public.whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS counts_dirty boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_broadcasts
  ADD COLUMN IF NOT EXISTS uncertain_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.whatsapp_broadcasts.counts_refreshed_at IS
  'When whatsapp_refresh_broadcast_counts last recomputed the counts from the recipient rows. NULL = the counts have never been computed (they read 0, which is not a measurement).';
COMMENT ON COLUMN public.whatsapp_broadcasts.counts_dirty IS
  'A debounced refresh was deferred; readers and the next batch end refresh it.';
COMMENT ON COLUMN public.whatsapp_broadcasts.open_count IS
  'Recipients still pending or sending. total = sent + failed + open + uncertain once counts_refreshed_at IS NOT NULL (NULL = never computed, not zero).';
COMMENT ON COLUMN public.whatsapp_broadcasts.uncertain_count IS
  'Recipients whose send outcome is unknown (send_uncertain). On a completed broadcast, the sends nobody can confirm.';

GRANT SELECT ON TABLE public.whatsapp_broadcast_recipients TO service_role;
GRANT SELECT, UPDATE ON TABLE public.whatsapp_broadcasts TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_refresh_broadcast_counts(
  p_broadcast_id          uuid,
  p_min_interval_seconds  integer DEFAULT 0
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_id      uuid;
  v_unknown text;
BEGIN
  IF p_broadcast_id IS NULL OR p_min_interval_seconds IS NULL OR p_min_interval_seconds < 0 THEN
    RAISE EXCEPTION 'whatsapp_refresh_broadcast_counts: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- Debounce: refreshed recently -> only mark dirty.
  IF p_min_interval_seconds > 0 THEN
    UPDATE public.whatsapp_broadcasts
       SET counts_dirty = true
     WHERE id = p_broadcast_id
       AND counts_refreshed_at IS NOT NULL
       AND counts_refreshed_at > now() - make_interval(secs => p_min_interval_seconds)
    RETURNING id INTO v_id;
    IF FOUND THEN
      RETURN 'deferred';
    END IF;
  END IF;

  -- Exhaustiveness: every status must fall in exactly one of the four buckets.
  SELECT string_agg(DISTINCT coalesce(r.status, '<null>'), ', ') INTO v_unknown
    FROM public.whatsapp_broadcast_recipients r
   WHERE r.broadcast_id = p_broadcast_id
     AND (r.status IS NULL OR r.status NOT IN (
       'sent', 'delivered', 'read',
       'failed', 'blocked_governance', 'blocked_send_control',
       'pending', 'sending',
       'send_uncertain'));
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'whatsapp_refresh_broadcast_counts: recipient status(es) in no count bucket: %', v_unknown
      USING ERRCODE = '22023';
  END IF;

  WITH c AS (
    SELECT count(*)::integer                                                                  AS total,
           (count(*) FILTER (WHERE r.status IN ('sent', 'delivered', 'read')))::integer      AS sent,
           (count(*) FILTER (WHERE r.status IN ('delivered', 'read')))::integer              AS delivered,
           (count(*) FILTER (WHERE r.status = 'read'))::integer                              AS read,
           (count(*) FILTER (WHERE r.status IN ('failed', 'blocked_governance', 'blocked_send_control')))::integer AS failed,
           (count(*) FILTER (WHERE r.status IN ('pending', 'sending')))::integer             AS open,
           (count(*) FILTER (WHERE r.status = 'send_uncertain'))::integer                    AS uncertain
      FROM public.whatsapp_broadcast_recipients r
     WHERE r.broadcast_id = p_broadcast_id
  )
  UPDATE public.whatsapp_broadcasts b
     SET total_recipients    = c.total,
         sent_count          = c.sent,
         delivered_count     = c.delivered,
         read_count          = c.read,
         failed_count        = c.failed,
         open_count          = c.open,
         uncertain_count     = c.uncertain,
         counts_refreshed_at = now(),
         counts_dirty        = false,
         status       = CASE WHEN b.status = 'running' AND c.open = 0 AND c.total > 0 THEN 'completed' ELSE b.status END,
         completed_at = CASE WHEN b.status = 'running' AND c.open = 0 AND c.total > 0 THEN coalesce(b.completed_at, now()) ELSE b.completed_at END
    FROM c
   WHERE b.id = p_broadcast_id
  RETURNING b.id INTO v_id;

  RETURN CASE WHEN FOUND THEN 'refreshed' ELSE 'missing' END;
END
$fn$;

COMMENT ON FUNCTION public.whatsapp_refresh_broadcast_counts(uuid, integer) IS
  'Recompute a WhatsApp broadcast''s counts from its recipient rows (idempotent); complete a running broadcast with nothing pending/sending. p_min_interval_seconds > 0 defers (marks dirty) a refresh within that window.';

REVOKE ALL ON FUNCTION public.whatsapp_refresh_broadcast_counts(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_refresh_broadcast_counts(uuid, integer) TO service_role;

DO $verify$
DECLARE
  v_fn     regprocedure := to_regprocedure('public.whatsapp_refresh_broadcast_counts(uuid, integer)');
  v_secdef boolean;
  v_config text[];
  v_leaked text[];
  v_n      integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_attribute
   WHERE attrelid = 'public.whatsapp_broadcasts'::regclass AND NOT attisdropped
     AND ((attname = 'counts_refreshed_at' AND NOT attnotnull)
       OR (attname IN ('counts_dirty', 'open_count', 'uncertain_count') AND attnotnull));
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'WBC postcondition: counts_refreshed_at (nullable) and counts_dirty, open_count, uncertain_count (NOT NULL) must exist';
  END IF;

  -- The recompute must be served by an index on (broadcast_id, status).
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'whatsapp_broadcast_recipients'
     AND indexdef LIKE '%(broadcast_id, status%';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'WBC postcondition: no index on whatsapp_broadcast_recipients (broadcast_id, status)';
  END IF;

  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'WBC postcondition: whatsapp_refresh_broadcast_counts(uuid, integer) is missing';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
  IF v_secdef THEN
    RAISE EXCEPTION 'WBC postcondition: the function must be SECURITY INVOKER';
  END IF;
  IF v_config IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (v_config)) THEN
    RAISE EXCEPTION 'WBC postcondition: search_path must be pinned, found %', coalesce(v_config::text, '{}');
  END IF;

  -- A NULL proacl means PUBLIC may execute, so the ACL is read, never assumed.
  SELECT array_agg(DISTINCT coalesce(r2.rolname, 'PUBLIC')) INTO v_leaked
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    LEFT JOIN pg_roles r2 ON r2.oid = a.grantee
   WHERE p.oid = v_fn AND a.privilege_type = 'EXECUTE'
     AND (a.grantee = 0 OR r2.rolname IN ('anon', 'authenticated', 'authenticator'));
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'WBC postcondition: EXECUTE must not be held by %', v_leaked;
  END IF;

  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR NOT has_table_privilege('service_role', 'public.whatsapp_broadcast_recipients', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.whatsapp_broadcasts', 'UPDATE') THEN
    RAISE EXCEPTION 'WBC postcondition: service_role must be able to execute the function and read/update what it touches';
  END IF;

  RAISE NOTICE 'WBC: whatsapp_refresh_broadcast_counts verified - INVOKER, search_path pinned, EXECUTE service_role only; counts columns present; (broadcast_id, status) index present.';
END
$verify$;

COMMIT;

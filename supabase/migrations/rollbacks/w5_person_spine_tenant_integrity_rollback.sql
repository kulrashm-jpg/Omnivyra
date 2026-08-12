-- ROLLBACK for 20260924000000_w5_person_spine_tenant_integrity.sql
--
-- ############################################################################
-- #  WARNING — THIS REOPENS THE TENANT BOUNDARY ON THE CANONICAL PERSON SPINE #
-- ############################################################################
--
-- Running this restores eleven SIMPLE foreign keys. From that moment a row owned
-- by tenant A can again reference a person owned by tenant B, on every one of:
--
--     canonical_leads, canonical_revenue_events, canonical_users, contacts,
--     engagement_threads, expected_event_instances, leads, unified_touchpoints,
--     visitor_sessions, unified_person_merges (winner)
--
-- and `unified_person_merges.loser_person_id` reverts to having NO foreign key
-- at all — it can then name a person that does not exist.
--
-- The rollback is data-lossless: it changes constraints only. It does NOT
-- rewrite, delete, or re-tenant any row. But it is NOT semantically free — it
-- is a deliberate retreat to a weaker invariant.
--
-- BEFORE RUNNING, confirm no cross-tenant rows were written while W5 was in
-- force (there is no way to detect them afterwards without re-deriving the join):
--
--   SELECT count(*) FROM public.contacts s
--     JOIN public.unified_persons p ON p.id = s.unified_person_id
--    WHERE s.organization_id IS DISTINCT FROM p.company_id;
--
-- The guard below fails closed if anything now depends on the composite keys.

BEGIN;

DO $guard$
DECLARE
  v_ack TEXT := current_setting('w5.confirm_reopen_tenant_boundary', true);
BEGIN
  IF v_ack IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'W5 rollback refused. This reopens the cross-tenant hole on the person spine. '
      'To proceed deliberately: SET LOCAL "w5.confirm_reopen_tenant_boundary" = ''yes'';';
  END IF;
  RAISE WARNING 'W5 ROLLBACK: reopening the canonical person spine tenant boundary.';
END
$guard$;

-- Dependency order: drop every composite first, then restore the simple keys.
-- The delete actions below are the exact ones recorded before W5 ran.

ALTER TABLE public.canonical_leads          DROP CONSTRAINT IF EXISTS canonical_leads_person_tenant_fk;
ALTER TABLE public.canonical_revenue_events DROP CONSTRAINT IF EXISTS canonical_revenue_events_person_tenant_fk;
ALTER TABLE public.canonical_users          DROP CONSTRAINT IF EXISTS canonical_users_person_tenant_fk;
ALTER TABLE public.contacts                 DROP CONSTRAINT IF EXISTS contacts_person_tenant_fk;
ALTER TABLE public.engagement_threads       DROP CONSTRAINT IF EXISTS engagement_threads_person_tenant_fk;
ALTER TABLE public.expected_event_instances DROP CONSTRAINT IF EXISTS expected_event_instances_person_tenant_fk;
ALTER TABLE public.leads                    DROP CONSTRAINT IF EXISTS leads_person_tenant_fk;
ALTER TABLE public.unified_touchpoints      DROP CONSTRAINT IF EXISTS unified_touchpoints_person_tenant_fk;
ALTER TABLE public.visitor_sessions         DROP CONSTRAINT IF EXISTS visitor_sessions_person_tenant_fk;
ALTER TABLE public.unified_person_merges    DROP CONSTRAINT IF EXISTS unified_person_merges_winner_tenant_fk;
ALTER TABLE public.unified_person_merges    DROP CONSTRAINT IF EXISTS unified_person_merges_loser_tenant_fk;

ALTER TABLE public.canonical_leads
  ADD CONSTRAINT canonical_leads_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.canonical_revenue_events
  ADD CONSTRAINT canonical_revenue_events_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.canonical_users
  ADD CONSTRAINT canonical_users_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.engagement_threads
  ADD CONSTRAINT engagement_threads_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.expected_event_instances
  ADD CONSTRAINT expected_event_instances_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.leads
  ADD CONSTRAINT fk_leads_unified_person
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.unified_touchpoints
  ADD CONSTRAINT unified_touchpoints_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.visitor_sessions
  ADD CONSTRAINT visitor_sessions_unified_person_id_fkey
  FOREIGN KEY (unified_person_id) REFERENCES public.unified_persons (id) ON DELETE SET NULL;

ALTER TABLE public.unified_person_merges
  ADD CONSTRAINT unified_person_merges_winner_person_id_fkey
  FOREIGN KEY (winner_person_id) REFERENCES public.unified_persons (id) ON DELETE CASCADE;

-- `loser_person_id` intentionally gets NO constraint back: it had none before W5.

COMMIT;

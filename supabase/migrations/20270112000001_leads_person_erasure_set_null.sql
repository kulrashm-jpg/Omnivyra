-- PI / person erasure — legacy `leads`: resolve the NOT NULL vs ON DELETE
-- SET NULL contradiction WITHOUT discarding the lead.
--
-- DEFECT. `leads.unified_person_id` is NOT NULL (baseline; identity-spine file
-- 6) while `leads_person_tenant_fk` (W5, 20260924000000) is
-- ON DELETE SET NULL (unified_person_id). Deleting any person that owns a
-- legacy lead therefore fails with 23502, which makes every lead-kind person
-- (and every bridged lead-kind person) unerasable. Today's two-call erasure
-- leaves such a person half-erased: provenance redacted, row and name kept.
--
-- WHAT THIS DOES NOT DO. It does not CASCADE (a lead is a business record with
-- its own children: form_conversions, lead_attributions, campaign_touchpoints)
-- and it does not silently drop the invariant "a lead belongs to a person".
-- It does not decide what happens to the lead's own personal fields (name,
-- email, phone, metadata, attribution) — that is the owner's subject_id /
-- retention decision (SUBJECT-ID-DECISION.md; owner-selectable step
-- 20270112000004). It does not touch any lead that is not the erased person's.
--
-- THE FIX (same shape as A6-10 option B and outreach_tasks.person_id, 20261011000000):
--   1. `person_erased_at timestamptz` — the explicit, auditable fact that the
--      lead's person was erased. NULL on every existing and every new lead.
--   2. unified_person_id DROP NOT NULL, replaced by
--      CHECK (unified_person_id IS NOT NULL OR person_erased_at IS NOT NULL):
--      a lead without a person is admissible ONLY once its person was erased.
--      Every writer that inserts or edits a live lead keeps exactly the
--      guarantee NOT NULL gave it.
--   3. a guard trigger:
--      INSERT  — a lead can never be created already-erased;
--      UPDATE  — person_erased_at can only be SET (never cleared or moved),
--                only by the erasure flow (pi_erasure_authorizations, scope
--                'legacy_leads', for this lead's tenant AND person), and only
--                as the sole change in that statement. Once erased, a lead can
--                never be re-linked to a person (no re-identification by relink)
--                and never moved to another tenant (J1 ER-3: company_id is
--                frozen for every role, service_role included).
--   4. pi_erasure_detach_legacy_leads(org, person) — owner-only (no client
--      role can execute it); called by pi_person_erasure_finalize in the same
--      transaction as the person delete. The FK's SET NULL then nulls the link.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'leads erasure preflight: public.leads is missing';
  END IF;
  IF to_regprocedure('public.pi_erasure_authorization_held(text, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'leads erasure preflight: apply 20270112000000_pi_erasure_authorizations first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'leads_person_tenant_fk' AND conrelid = 'public.leads'::regclass
                    AND confdeltype = 'n') THEN
    RAISE EXCEPTION 'leads erasure preflight: leads_person_tenant_fk (ON DELETE SET NULL) is missing';
  END IF;
END
$preflight$;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS person_erased_at timestamptz;

COMMENT ON COLUMN public.leads.person_erased_at IS
  'When the lead''s person (unified_person_id) was erased by pi_person_erasure_finalize. NULL for '
  'every live lead. Set only by the erasure flow; never cleared. A lead with a NULL person is '
  'admissible only when this is set (leads_person_or_erased).';

-- Guard first, so the relaxed column is never unguarded.
CREATE OR REPLACE FUNCTION public.leads_person_erasure_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.person_erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'leads: a lead cannot be created with an erased person (person_erased_at must be NULL)'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.person_erased_at IS NOT NULL THEN
    -- An erased lead stays erased, and is never re-linked to anybody.
    IF NEW.person_erased_at IS DISTINCT FROM OLD.person_erased_at THEN
      RAISE EXCEPTION 'leads: person_erased_at of lead % is permanent', OLD.id USING ERRCODE = '23514';
    END IF;
    IF NEW.unified_person_id IS NOT NULL
       AND NEW.unified_person_id IS DISTINCT FROM OLD.unified_person_id THEN
      RAISE EXCEPTION 'leads: lead % belonged to an erased person and cannot be re-linked', OLD.id
        USING ERRCODE = '23514';
    END IF;
    -- J1 ER-3: an erased lead stays in the tenant it was erased in (no role may
    -- move it; the erasure ledger and provenance event are keyed by that tenant).
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'leads: lead % belonged to an erased person and cannot change tenant', OLD.id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.person_erased_at IS NOT NULL THEN
    -- The ONE sanctioned transition on a live lead: stamp the erasure, nothing else.
    IF OLD.unified_person_id IS NULL
       OR NOT public.pi_erasure_authorization_held('legacy_leads', OLD.company_id, OLD.unified_person_id) THEN
      RAISE EXCEPTION 'leads: person_erased_at may only be set by the person-erasure flow (lead %)', OLD.id
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'person_erased_at') IS DISTINCT FROM (to_jsonb(OLD) - 'person_erased_at') THEN
      RAISE EXCEPTION 'leads: the erasure stamp on lead % must be the only change', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.leads_person_erasure_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_leads_person_erasure_guard ON public.leads;
CREATE TRIGGER trg_leads_person_erasure_guard
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_person_erasure_guard();

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_person_or_erased'
                    AND conrelid = 'public.leads'::regclass) THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_person_or_erased
      CHECK (unified_person_id IS NOT NULL OR person_erased_at IS NOT NULL);
  END IF;
END
$check$;

ALTER TABLE public.leads ALTER COLUMN unified_person_id DROP NOT NULL;

COMMENT ON COLUMN public.leads.unified_person_id IS
  'The lead''s canonical person. Required for every live lead (leads_person_or_erased). NULL only '
  'after the person was erased: leads_person_tenant_fk is ON DELETE SET NULL (unified_person_id) '
  'and the erasure flow stamps person_erased_at first.';

-- ── the sanctioned detach (owner-only) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_erasure_detach_legacy_leads(p_organization_id uuid, p_person_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_organization_id IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'pi_erasure_detach_legacy_leads: tenant and person are required' USING ERRCODE = '22023';
  END IF;
  -- A person of ANOTHER tenant is refused before anything is written. (The
  -- composite FK already makes a cross-tenant lead link impossible.)
  IF EXISTS (SELECT 1 FROM public.unified_persons p
              WHERE p.id = p_person_id AND p.company_id IS DISTINCT FROM p_organization_id) THEN
    RAISE EXCEPTION 'pi_erasure_detach_legacy_leads: the person belongs to another tenant' USING ERRCODE = '42501';
  END IF;

  PERFORM public.pi_erasure_authorize('legacy_leads', p_organization_id, p_person_id);
  UPDATE public.leads l
     SET person_erased_at = now()
   WHERE l.company_id = p_organization_id
     AND l.unified_person_id = p_person_id
     AND l.person_erased_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.pi_erasure_release('legacy_leads', p_organization_id, p_person_id);
  RETURN v_n;
END
$fn$;

DO $revoke_fn$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION public.pi_erasure_detach_legacy_leads(uuid, uuid) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.pi_erasure_detach_legacy_leads(uuid, uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.leads_person_erasure_guard() FROM %I', r);
    END IF;
  END LOOP;
END
$revoke_fn$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'leads'
                AND column_name = 'unified_person_id' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'leads erasure postcondition: unified_person_id is still NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_person_or_erased'
                    AND conrelid = 'public.leads'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'leads erasure postcondition: leads_person_or_erased missing or not validated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_leads_person_erasure_guard'
                    AND tgrelid = 'public.leads'::regclass AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'leads erasure postcondition: trg_leads_person_erasure_guard missing or disabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     AND has_function_privilege('service_role', 'public.pi_erasure_detach_legacy_leads(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'leads erasure postcondition: service_role must not execute the detach directly';
  END IF;
END
$verify$;

COMMIT;

-- Rollback (valid only while no lead has person_erased_at set; otherwise the
-- SET NOT NULL fails, by design — an erased lead cannot regain a person):
--   ALTER TABLE public.leads ALTER COLUMN unified_person_id SET NOT NULL;
--   ALTER TABLE public.leads DROP CONSTRAINT leads_person_or_erased;
--   DROP TRIGGER trg_leads_person_erasure_guard ON public.leads;
--   DROP FUNCTION public.leads_person_erasure_guard();
--   DROP FUNCTION public.pi_erasure_detach_legacy_leads(uuid, uuid);
--   ALTER TABLE public.leads DROP COLUMN person_erased_at;

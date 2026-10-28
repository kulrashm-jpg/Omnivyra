-- ===========================================================================
-- Orchestration — the community journey link must concern the run's PERSON.
--
-- WHAT THIS ADDS (evolves 20261231000003; does not edit it)
--   On `community_action_journey_links`:
--     person_id          the run's canonical person (unified_persons) the action
--                        was proven to concern. Composite tenant FK.
--     identity_claim_id  the identity_claims row that proved it (provenance).
--   A second guard, `community_action_journey_links_identity_guard`, that
--   re-proves at INSERT what the application proved
--   (backend/services/orchestration/communityIdentityProof.ts):
--
--     execution task (subject_kind, subject_id)
--       → leads / canonical_leads .unified_person_id  = NEW.person_id
--     community_ai_actions.discovered_user_id
--       → community_ai_discovered_users (same tenant, same platform)
--       → identity_claims: ONE active external_id claim on that platform for
--         that normalized provider id, VERIFIED, person_id = NEW.person_id
--     follow: target_id IS that provider id; dm: recipient IS that provider id
--     and never a thread (`dm_thread_ready`).
--
-- ─── WHY THIS IS THE AUTHORITATIVE MAPPING, AND WHAT IS STILL MISSING ─────
--   identity_claims (20260920000000) is the canonical, tenant-scoped external
--   identity store, unique on (organization_id, claim_type, platform,
--   normalized_value) among active rows. Only a claim a person has VERIFIED
--   (verification_state 'verified', verified_at set) is accepted: every writer
--   in the repository today records 'unverified'. Until a verification writer
--   exists, every link attempt is refused `identity_unverified` /
--   `identity_unclaimed` — by design, nothing is guessed. Names, usernames,
--   profile URLs (external_profile, deferred), companies, email domains and
--   phones are never identity keys.
--
-- ─── INVARIANTS ADDED (database-enforced) ─────────────────────────────────
--   person       NEW.person_id is the run's subject's person, in this tenant.
--   identity     NEW.identity_claim_id is an active, verified external_id claim
--                of this tenant, for the action's platform account, owned by
--                NEW.person_id, and the only active claim for that account.
--   addressing   a follow / dm is addressed to that account, never elsewhere.
--   erasure      deleting the person deletes its links (ON DELETE CASCADE): an
--                erased person can never be acted on through a stale link.
--
-- Touches NO other table's columns, constraints or status semantics (not
-- community_ai_actions, not identity_claims, not community_ai_discovered_users).
-- Additive. NOT applied anywhere yet.
-- ROLLBACK: supabase/migrations/rollbacks/community_identity_link_rollback.sql
--
-- NOTE for the integration owner: 20261231000003's postcondition counts the
-- link table's foreign keys (expects 3). After this migration there are 4, so
-- re-running 20261231000003 alone after this one would fail that postcondition.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.community_action_journey_links') IS NULL THEN
    RAISE EXCEPTION 'community identity link: community_action_journey_links (20261231000003) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal AND tgname = 'trg_community_action_journey_links_guard'
       AND tgrelid = 'public.community_action_journey_links'::regclass
  ) THEN
    RAISE EXCEPTION 'community identity link: the 20261231000003 link guard is missing';
  END IF;
  IF to_regclass('public.identity_claims') IS NULL THEN
    RAISE EXCEPTION 'community identity link: identity_claims (20260920000000) is missing';
  END IF;
  IF to_regclass('public.uq_unified_persons_id_company') IS NULL THEN
    RAISE EXCEPTION 'community identity link: uq_unified_persons_id_company is missing — no tenant-safe person reference';
  END IF;
  IF to_regclass('public.community_ai_discovered_users') IS NULL THEN
    RAISE EXCEPTION 'community identity link: community_ai_discovered_users is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'community_ai_actions'
                    AND column_name = 'discovered_user_id') THEN
    RAISE EXCEPTION 'community identity link: community_ai_actions.discovered_user_id is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'leads'
                    AND column_name = 'unified_person_id')
  OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'canonical_leads'
                    AND column_name = 'unified_person_id') THEN
    RAISE EXCEPTION 'community identity link: leads / canonical_leads .unified_person_id is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'execution_tasks'
                    AND column_name = 'subject_kind') THEN
    RAISE EXCEPTION 'community identity link: execution_tasks.subject_kind is missing';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The proven person and its provenance.
-- ---------------------------------------------------------------------------
ALTER TABLE public.community_action_journey_links ADD COLUMN IF NOT EXISTS person_id uuid;
ALTER TABLE public.community_action_journey_links ADD COLUMN IF NOT EXISTS identity_claim_id uuid;

-- A link made before this migration proves no person. It must not survive as
-- executable, and links are immutable, so it cannot be back-filled: refuse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.community_action_journey_links
              WHERE person_id IS NULL OR identity_claim_id IS NULL) THEN
    RAISE EXCEPTION 'community identity link: % link(s) carry no proven person; an operator must remove them (DELETE) before this migration',
      (SELECT count(*) FROM public.community_action_journey_links WHERE person_id IS NULL OR identity_claim_id IS NULL);
  END IF;
END $$;

ALTER TABLE public.community_action_journey_links ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE public.community_action_journey_links ALTER COLUMN identity_claim_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.community_action_journey_links'::regclass
                    AND conname = 'community_action_journey_links_person_fk') THEN
    ALTER TABLE public.community_action_journey_links
      ADD CONSTRAINT community_action_journey_links_person_fk
      FOREIGN KEY (person_id, organization_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_community_action_journey_links_person
  ON public.community_action_journey_links (organization_id, person_id);

COMMENT ON COLUMN public.community_action_journey_links.person_id IS
  'The run''s canonical person the linked action was proven to concern (verified external_id identity claim). Re-proven at execution time.';
COMMENT ON COLUMN public.community_action_journey_links.identity_claim_id IS
  'Provenance: the identity_claims row (active, verified, external_id) that proved the person at link time. Not a foreign key: revocation is detected by re-proof, and erasure must not be blocked.';

-- ---------------------------------------------------------------------------
-- 2. The provider-id normalizer, mirroring normalizeExternalIdentity
--    (backend/services/prospectIdentity/normalization.ts). It is only ever used
--    to REFUSE: a divergence can block a link, never admit one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_identity_normalize_external_id(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw text := lower(btrim(coalesce(p_value, ''), E' \t\n\r\f\v'));
  v_s   text;
BEGIN
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;
  IF v_raw ~ '^[a-z][a-z0-9+.-]*://' OR position('/' IN v_raw) > 0 THEN
    v_s := regexp_replace(v_raw, '^[a-z][a-z0-9+.-]*://', '');
    v_s := split_part(split_part(v_s, '?', 1), '#', 1);
    v_s := regexp_replace(v_s, '/+$', '');
    v_s := regexp_replace(v_s, '^www[.]', '');
    RETURN nullif(v_s, '');
  END IF;
  RETURN nullif(regexp_replace(v_raw, '^@', ''), '');
END $$;

-- ---------------------------------------------------------------------------
-- 3. The identity guard — runs after the 20261231000003 guard (trigger names
--    fire alphabetically: ..._guard < ..._identity_guard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.community_action_journey_links_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task     record;
  v_person   uuid;
  v_action   record;
  v_du       record;
  v_claim    record;
  v_platform text;
  v_provider text;
  v_type     text;
  v_active   integer;
BEGIN
  -- UPDATE is refused by the 20261231000003 guard (immutable links).
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.person_id IS NULL OR NEW.identity_claim_id IS NULL THEN
    RAISE EXCEPTION 'cajl:person_unresolved' USING ERRCODE = '23514';
  END IF;

  -- The run's person, from the task's subject, tenant-first.
  SELECT t.subject_kind, t.subject_id
    INTO v_task
    FROM public.execution_tasks t
   WHERE t.id = NEW.execution_task_id AND t.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cajl:task_not_found' USING ERRCODE = '23514';
  END IF;
  IF v_task.subject_kind = 'lead' THEN
    SELECT l.unified_person_id INTO v_person
      FROM public.leads l
     WHERE l.company_id = NEW.organization_id AND l.id::text = v_task.subject_id;
  ELSIF v_task.subject_kind = 'prospect' THEN
    SELECT c.unified_person_id INTO v_person
      FROM public.canonical_leads c
     WHERE c.company_id = NEW.organization_id AND c.id::text = v_task.subject_id;
  ELSE
    RAISE EXCEPTION 'cajl:person_unresolved' USING ERRCODE = '23514';
  END IF;
  IF v_person IS NULL THEN
    RAISE EXCEPTION 'cajl:person_unresolved' USING ERRCODE = '23514';
  END IF;
  IF v_person IS DISTINCT FROM NEW.person_id THEN
    RAISE EXCEPTION 'cajl:person_mismatch' USING ERRCODE = '23514';
  END IF;

  -- The platform account the action engages.
  SELECT a.tenant_id, a.platform, a.action_type, a.target_id, a.discovered_user_id,
         (to_jsonb(a) -> 'metadata') AS metadata
    INTO v_action
    FROM public.community_ai_actions a
   WHERE a.id = NEW.community_action_id AND a.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cajl:action_not_found' USING ERRCODE = '23514';
  END IF;
  IF v_action.tenant_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'cajl:identity_cross_tenant' USING ERRCODE = '23514';
  END IF;
  IF v_action.discovered_user_id IS NULL THEN
    RAISE EXCEPTION 'cajl:identity_missing' USING ERRCODE = '23514';
  END IF;

  SELECT d.tenant_id, d.platform, d.external_user_id
    INTO v_du
    FROM public.community_ai_discovered_users d
   WHERE d.id = v_action.discovered_user_id AND d.organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cajl:identity_missing' USING ERRCODE = '23514';
  END IF;
  IF v_du.tenant_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'cajl:identity_cross_tenant' USING ERRCODE = '23514';
  END IF;
  v_platform := lower(btrim(coalesce(v_du.platform, '')));
  IF v_platform = '' OR v_platform IS DISTINCT FROM lower(btrim(coalesce(v_action.platform, ''))) THEN
    RAISE EXCEPTION 'cajl:identity_platform_mismatch' USING ERRCODE = '23514';
  END IF;
  v_provider := public.community_identity_normalize_external_id(v_du.external_user_id);
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'cajl:identity_missing' USING ERRCODE = '23514';
  END IF;

  -- What the action addresses must be that account.
  v_type := lower(btrim(coalesce(v_action.action_type, '')));
  IF v_type = 'follow'
     AND public.community_identity_normalize_external_id(v_action.target_id) IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION 'cajl:target_actor_mismatch' USING ERRCODE = '23514';
  END IF;
  IF v_type = 'dm' THEN
    IF coalesce(v_action.metadata -> 'dm_thread_ready', 'null'::jsonb) = 'true'::jsonb THEN
      RAISE EXCEPTION 'cajl:dm_recipient_unproven' USING ERRCODE = '23514';
    END IF;
    IF public.community_identity_normalize_external_id(v_action.target_id) IS DISTINCT FROM v_provider THEN
      RAISE EXCEPTION 'cajl:dm_recipient_unproven' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- The authoritative mapping: account → person.
  SELECT c.person_id, c.claim_type, c.platform, c.normalized_value,
         c.verification_state, c.verified_at, c.revoked_at
    INTO v_claim
    FROM public.identity_claims c
   WHERE c.id = NEW.identity_claim_id AND c.organization_id = NEW.organization_id;
  IF NOT FOUND OR v_claim.revoked_at IS NOT NULL
     OR v_claim.claim_type IS DISTINCT FROM 'external_id' OR v_claim.person_id IS NULL THEN
    RAISE EXCEPTION 'cajl:identity_unclaimed' USING ERRCODE = '23514';
  END IF;
  IF v_claim.platform IS DISTINCT FROM v_platform OR v_claim.normalized_value IS DISTINCT FROM v_provider THEN
    RAISE EXCEPTION 'cajl:identity_mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_active
    FROM public.identity_claims c
   WHERE c.organization_id = NEW.organization_id AND c.claim_type = 'external_id'
     AND c.platform = v_platform AND c.normalized_value = v_provider AND c.revoked_at IS NULL;
  IF v_active > 1 THEN
    RAISE EXCEPTION 'cajl:identity_ambiguous' USING ERRCODE = '23514';
  END IF;
  IF v_claim.verification_state IS DISTINCT FROM 'verified' OR v_claim.verified_at IS NULL THEN
    RAISE EXCEPTION 'cajl:identity_unverified' USING ERRCODE = '23514';
  END IF;
  IF v_claim.person_id IS DISTINCT FROM NEW.person_id THEN
    RAISE EXCEPTION 'cajl:identity_mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_community_action_journey_links_identity_guard ON public.community_action_journey_links;
CREATE TRIGGER trg_community_action_journey_links_identity_guard
  BEFORE INSERT ON public.community_action_journey_links
  FOR EACH ROW EXECUTE FUNCTION public.community_action_journey_links_identity_guard();

-- ---------------------------------------------------------------------------
-- 4. Postconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'community_action_journey_links'
                AND column_name IN ('person_id', 'identity_claim_id') AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'community identity link postcondition: person_id / identity_claim_id are nullable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.community_action_journey_links'::regclass
                    AND conname = 'community_action_journey_links_person_fk' AND contype = 'f') THEN
    RAISE EXCEPTION 'community identity link postcondition: the tenant-composite person FK is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE NOT tgisinternal AND tgname = 'trg_community_action_journey_links_identity_guard'
                    AND tgrelid = 'public.community_action_journey_links'::regclass) THEN
    RAISE EXCEPTION 'community identity link postcondition: the identity guard is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE NOT tgisinternal AND tgname = 'trg_community_action_journey_links_guard'
                    AND tgrelid = 'public.community_action_journey_links'::regclass) THEN
    RAISE EXCEPTION 'community identity link postcondition: the 20261231000003 guard was lost';
  END IF;
  -- Still identity only: no lifecycle or content column leaked in.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'community_action_journey_links'
                AND column_name IN ('status', 'state', 'platform', 'action_type', 'target_id',
                                    'suggested_text', 'final_text', 'approved_at', 'executed_at',
                                    'execution_result', 'external_user_id', 'profile_url')) THEN
    RAISE EXCEPTION 'community identity link postcondition: a lifecycle/content column leaked into the link';
  END IF;
END $$;

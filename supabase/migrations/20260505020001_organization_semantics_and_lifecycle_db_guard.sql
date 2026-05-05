-- Collapse organization semantics at the DB layer and enforce lifecycle/invite integrity.

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL
     AND to_regclass('public.companies') IS NOT NULL THEN
    ALTER TABLE public.companies RENAME TO organizations;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL
     AND to_regclass('public.organizations') IS NOT NULL THEN
    CREATE VIEW public.companies AS
      SELECT * FROM public.organizations;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_state') THEN
    CREATE TYPE public.user_state AS ENUM (
      'invited',
      'pending',
      'active',
      'suspended',
      'deleted'
    );
  END IF;
END $$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS restored_from_state public.user_state,
  ADD COLUMN IF NOT EXISTS restored_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS restored_by uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'state'
      AND udt_name <> 'user_state'
  ) THEN
    ALTER TABLE public.users
      ALTER COLUMN state DROP DEFAULT;

    ALTER TABLE public.users
      ALTER COLUMN state TYPE public.user_state
      USING state::public.user_state;

    ALTER TABLE public.users
      ALTER COLUMN state SET DEFAULT 'pending'::public.user_state;
  END IF;
END $$;

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE public.invitations
SET organization_id = COALESCE(organization_id, company_id)
WHERE organization_id IS NULL;

DO $$
DECLARE
  unmapped_count integer;
BEGIN
  SELECT count(*) INTO unmapped_count
  FROM public.invitations
  WHERE organization_id IS NULL;

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce invitations.organization_id NOT NULL: % rows have no organization mapping', unmapped_count;
  END IF;
END $$;

ALTER TABLE public.invitations
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invitations_organization_id_fkey'
      AND conrelid = 'public.invitations'::regclass
  ) THEN
    ALTER TABLE public.invitations
      ADD CONSTRAINT invitations_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id);
  END IF;
END $$;

DROP INDEX IF EXISTS public.invitations_active_per_org_email_unique;
DROP INDEX IF EXISTS public.invitations_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS invitations_active_organization_email_unique
  ON public.invitations (lower(email), organization_id)
  WHERE status = 'invited';

ALTER TABLE public.company_domains
  ADD COLUMN IF NOT EXISTS organization_id uuid;

UPDATE public.company_domains
SET organization_id = COALESCE(organization_id, company_id)
WHERE organization_id IS NULL;

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT final_domain
    FROM public.company_domains
    WHERE final_domain IS NOT NULL
    GROUP BY final_domain
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot proceed: duplicate company_domains.final_domain rows exist';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_domains_organization_id_fkey'
      AND conrelid = 'public.company_domains'::regclass
  ) THEN
    ALTER TABLE public.company_domains
      ADD CONSTRAINT company_domains_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_final_domain_unique
  ON public.company_domains (final_domain);

CREATE OR REPLACE FUNCTION public.is_valid_user_state_transition(
  previous_state public.user_state,
  next_state public.user_state
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF previous_state = next_state AND previous_state <> 'pending'::public.user_state THEN
    RETURN true;
  END IF;

  RETURN
    (previous_state = 'invited'::public.user_state AND next_state IN ('pending'::public.user_state, 'deleted'::public.user_state))
    OR (previous_state = 'pending'::public.user_state AND next_state = 'active'::public.user_state)
    OR (previous_state = 'active'::public.user_state AND next_state IN ('suspended'::public.user_state, 'deleted'::public.user_state))
    OR (previous_state = 'suspended'::public.user_state AND next_state = 'active'::public.user_state)
    OR (previous_state = 'deleted'::public.user_state AND next_state = 'active'::public.user_state);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_user_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD.state IS DISTINCT FROM NEW.state THEN
    IF NOT public.is_valid_user_state_transition(OLD.state, NEW.state) THEN
      RAISE EXCEPTION 'Invalid user state transition: % -> %', OLD.state, NEW.state;
    END IF;

    IF OLD.state = 'deleted'::public.user_state AND NEW.state = 'active'::public.user_state THEN
      IF NEW.restored_by IS NULL OR NEW.restored_at IS NULL OR NEW.restored_from_state IS NULL THEN
        RAISE EXCEPTION 'Restore requires restored_by, restored_at, and restored_from_state audit fields';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_user_state_transition ON public.users;
CREATE TRIGGER trg_validate_user_state_transition
  BEFORE UPDATE OF state ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_user_state_transition();

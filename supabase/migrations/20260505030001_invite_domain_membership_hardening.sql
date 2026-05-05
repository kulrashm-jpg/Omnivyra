BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'invite_status'
  ) THEN
    CREATE TYPE public.invite_status AS ENUM ('invited', 'accepted', 'expired');
  END IF;
END $$;

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS accepted_user_id uuid NULL;

UPDATE public.invitations
SET accepted_user_id = accepted_by
WHERE accepted_user_id IS NULL
  AND accepted_by IS NOT NULL;

ALTER TABLE public.invitations
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.invitations
  ALTER COLUMN status TYPE public.invite_status
  USING status::public.invite_status;

ALTER TABLE public.invitations
  ALTER COLUMN status SET DEFAULT 'invited'::public.invite_status;

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_accepted_user_required,
  ADD CONSTRAINT invitations_accepted_user_required
  CHECK (status <> 'accepted'::public.invite_status OR accepted_user_id IS NOT NULL);

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_accepted_user_id_fkey,
  ADD CONSTRAINT invitations_accepted_user_id_fkey
  FOREIGN KEY (accepted_user_id) REFERENCES public.users(id);

ALTER TABLE public.user_company_roles
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_company_id_deprecated,
  ADD CONSTRAINT users_company_id_deprecated
  CHECK (company_id IS NULL) NOT VALID;

UPDATE public.user_company_roles
SET organization_id = company_id
WHERE organization_id IS NULL
  AND company_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_company_roles
    WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'user_company_roles.organization_id cannot be null before hardening';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_company_roles
    GROUP BY user_id, organization_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate user_company_roles rows for user_id, organization_id';
  END IF;
END $$;

ALTER TABLE public.user_company_roles
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.user_company_roles
  DROP CONSTRAINT IF EXISTS user_company_roles_organization_id_fkey,
  ADD CONSTRAINT user_company_roles_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id);

DROP INDEX IF EXISTS public.user_company_roles_user_organization_unique;

CREATE UNIQUE INDEX user_company_roles_user_organization_unique
  ON public.user_company_roles(user_id, organization_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.company_domains
    WHERE organization_id IS NOT NULL
      AND verification_status <> 'verified'
  ) THEN
    RAISE EXCEPTION 'company_domains.organization_id may only be set for verified domains';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_verified_domain_binding()
RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL
    AND NEW.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'Only verified domains may bind to an organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_verified_domain_binding ON public.company_domains;

CREATE TRIGGER trg_validate_verified_domain_binding
  BEFORE INSERT OR UPDATE OF organization_id, verification_status
  ON public.company_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_verified_domain_binding();

CREATE OR REPLACE FUNCTION public.create_verified_organization_with_domain(
  p_name text,
  p_domain text,
  p_method text,
  p_token text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  normalized_domain text := lower(regexp_replace(regexp_replace(trim(p_domain), '^https?://', ''), '^www\.', ''));
  created_organization_id uuid;
  created_name text;
BEGIN
  IF normalized_domain IS NULL OR normalized_domain = '' THEN
    RAISE EXCEPTION 'domain is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(normalized_domain));

  PERFORM 1
  FROM public.company_domains
  WHERE final_domain = normalized_domain
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'DOMAIN_ALREADY_REGISTERED';
  END IF;

  INSERT INTO public.organizations (
    name,
    website,
    website_domain,
    status,
    created_at,
    updated_at
  )
  VALUES (
    trim(p_name),
    normalized_domain,
    normalized_domain,
    'active',
    now(),
    now()
  )
  RETURNING id, name INTO created_organization_id, created_name;

  INSERT INTO public.company_domains (
    organization_id,
    company_id,
    input_domain,
    final_domain,
    is_primary,
    verified,
    verification_status,
    verification_method,
    verification_token,
    verified_at,
    created_via,
    created_at
  )
  VALUES (
    created_organization_id,
    created_organization_id,
    normalized_domain,
    normalized_domain,
    true,
    true,
    'verified',
    p_method,
    p_token,
    now(),
    'user',
    now()
  );

  RETURN jsonb_build_object(
    'organization_id', created_organization_id,
    'name', created_name,
    'domain', normalized_domain
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

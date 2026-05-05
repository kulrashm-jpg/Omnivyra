-- Foundation integrity for canonical organization identity, user lifecycle, and invites.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'pending';

UPDATE public.users u
SET organization_id = COALESCE(u.organization_id, u.company_id, active_roles.company_id)
FROM (
  SELECT DISTINCT ON (user_id) user_id, company_id
  FROM public.user_company_roles
  WHERE status = 'active'
  ORDER BY user_id, created_at DESC NULLS LAST
) active_roles
WHERE u.id = active_roles.user_id
  AND u.organization_id IS NULL;

UPDATE public.users
SET organization_id = company_id
WHERE organization_id IS NULL
  AND company_id IS NOT NULL;

UPDATE public.users
SET state = CASE
  WHEN is_deleted THEN 'deleted'
  WHEN onboarding_state IN ('profile_complete', 'company_complete', 'active') THEN 'active'
  ELSE 'pending'
END
WHERE state IS NULL OR state NOT IN ('invited', 'pending', 'active', 'suspended', 'deleted');

DO $$
DECLARE
  unmapped_count integer;
BEGIN
  SELECT count(*) INTO unmapped_count
  FROM public.users
  WHERE organization_id IS NULL;

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce users.organization_id NOT NULL: % user rows have no organization mapping', unmapped_count;
  END IF;
END $$;

ALTER TABLE public.users
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_organization_id_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.companies(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_state_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_state_check
      CHECK (state IN ('invited', 'pending', 'active', 'suspended', 'deleted'));
  END IF;
END $$;

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'invited',
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

UPDATE public.invitations
SET status = CASE
  WHEN accepted_at IS NOT NULL THEN 'accepted'
  WHEN revoked_at IS NOT NULL OR expires_at <= now() THEN 'expired'
  ELSE 'invited'
END
WHERE status IS NULL OR status NOT IN ('invited', 'accepted', 'expired');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invitations_status_check'
      AND conrelid = 'public.invitations'::regclass
  ) THEN
    ALTER TABLE public.invitations
      ADD CONSTRAINT invitations_status_check
      CHECK (status IN ('invited', 'accepted', 'expired'));
  END IF;
END $$;

DROP INDEX IF EXISTS public.invitations_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS invitations_active_per_org_email_unique
  ON public.invitations (lower(email), company_id)
  WHERE status = 'invited';

CREATE INDEX IF NOT EXISTS idx_users_organization_id ON public.users (organization_id);
CREATE INDEX IF NOT EXISTS idx_users_state ON public.users (state);

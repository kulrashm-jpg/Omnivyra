-- Company membership identity hardening
-- Prevent self-registered/self-joined users from being attached to a company
-- whose domain does not match their verified work-email domain, and prevent
-- users.active_company_id from pointing at an invalid active membership.

UPDATE user_company_roles
SET join_source = 'self_joined'
WHERE join_source = 'self_registered';

ALTER TABLE user_company_roles
  DROP CONSTRAINT IF EXISTS user_company_roles_join_source_check;

ALTER TABLE user_company_roles
  ADD CONSTRAINT user_company_roles_join_source_check
  CHECK (join_source IN ('invited', 'self_joined'));

CREATE OR REPLACE FUNCTION omnivyra_is_free_email_domain(p_domain text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(p_domain, '')) IN (
    'gmail.com', 'googlemail.com',
    'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'yahoo.ca',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'proton.me',
    'aol.com', 'mail.com',
    'zoho.com', 'yandex.com',
    'gmx.com', 'gmx.net',
    'tutanota.com'
  );
$$;

CREATE OR REPLACE FUNCTION omnivyra_extract_email_domain(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(lower(split_part(coalesce(p_email, ''), '@', 2)), '');
$$;

CREATE OR REPLACE FUNCTION omnivyra_self_joined_role_matches_company_domain(
  p_user_id uuid,
  p_company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_email_domain text;
  v_website_domain text;
  v_admin_email_domain text;
BEGIN
  SELECT omnivyra_extract_email_domain(email)
  INTO v_email_domain
  FROM users
  WHERE id = p_user_id;

  IF v_email_domain IS NULL OR omnivyra_is_free_email_domain(v_email_domain) THEN
    RETURN true;
  END IF;

  SELECT lower(nullif(website_domain, '')), lower(nullif(admin_email_domain, ''))
  INTO v_website_domain, v_admin_email_domain
  FROM companies
  WHERE id = p_company_id;

  IF v_website_domain IS NULL AND v_admin_email_domain IS NULL THEN
    RETURN true;
  END IF;

  RETURN v_email_domain IN (v_website_domain, v_admin_email_domain);
END;
$$;

UPDATE user_company_roles
SET status = 'inactive',
    deactivated_at = coalesce(deactivated_at, now()),
    updated_at = now()
WHERE status = 'active'
  AND join_source = 'self_joined'
  AND NOT omnivyra_self_joined_role_matches_company_domain(user_id, company_id);

WITH replacement AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    company_id
  FROM user_company_roles
  WHERE status = 'active'
  ORDER BY user_id, created_at DESC NULLS LAST
)
UPDATE users u
SET active_company_id = replacement.company_id,
    updated_at = now()
FROM replacement
WHERE u.id = replacement.user_id
  AND u.active_company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_company_roles r
    WHERE r.user_id = u.id
      AND r.company_id = u.active_company_id
      AND r.status = 'active'
  );

UPDATE users u
SET active_company_id = NULL,
    updated_at = now()
WHERE u.active_company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_company_roles r
    WHERE r.user_id = u.id
      AND r.status = 'active'
  );

CREATE OR REPLACE FUNCTION omnivyra_enforce_self_joined_company_domain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.join_source := CASE
    WHEN NEW.join_source = 'self_registered' THEN 'self_joined'
    ELSE NEW.join_source
  END;

  IF NEW.status = 'active'
     AND NEW.join_source = 'self_joined'
     AND NOT omnivyra_self_joined_role_matches_company_domain(NEW.user_id, NEW.company_id)
  THEN
    RAISE EXCEPTION
      'self_joined membership domain mismatch for user % and company %',
      NEW.user_id,
      NEW.company_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_company_roles_self_joined_domain_guard ON user_company_roles;

CREATE TRIGGER trg_user_company_roles_self_joined_domain_guard
BEFORE INSERT OR UPDATE OF user_id, company_id, status, join_source
ON user_company_roles
FOR EACH ROW
EXECUTE FUNCTION omnivyra_enforce_self_joined_company_domain();

CREATE OR REPLACE FUNCTION omnivyra_enforce_active_company_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_join_source text;
BEGIN
  IF NEW.active_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT join_source
  INTO v_join_source
  FROM user_company_roles
  WHERE user_id = NEW.id
    AND company_id = NEW.active_company_id
    AND status = 'active'
  LIMIT 1;

  IF v_join_source IS NULL THEN
    RAISE EXCEPTION
      'active_company_id % is not an active membership for user %',
      NEW.active_company_id,
      NEW.id
      USING ERRCODE = '23514';
  END IF;

  IF v_join_source = 'self_joined'
     AND NOT omnivyra_self_joined_role_matches_company_domain(NEW.id, NEW.active_company_id)
  THEN
    RAISE EXCEPTION
      'active_company_id domain mismatch for user % and company %',
      NEW.id,
      NEW.active_company_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_active_company_membership_guard ON users;

CREATE TRIGGER trg_users_active_company_membership_guard
BEFORE INSERT OR UPDATE OF active_company_id
ON users
FOR EACH ROW
EXECUTE FUNCTION omnivyra_enforce_active_company_membership();

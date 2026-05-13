-- Repair malformed search_path on credit reservation RPCs.
--
-- A previous function definition stored:
--   SET search_path TO 'public, extensions'
-- which PostgreSQL treats as a single schema name containing a comma. The
-- function then cannot resolve unqualified relations such as organization_credits
-- even when public.organization_credits exists.

ALTER FUNCTION public.apply_credit_reservation(
  uuid,
  text,
  integer,
  integer,
  integer,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text
) SET search_path = public, extensions;

ALTER FUNCTION public.apply_credit_partial_confirm(
  uuid,
  uuid,
  integer,
  integer,
  integer,
  text,
  text,
  text,
  text,
  uuid
) SET search_path = public, extensions;

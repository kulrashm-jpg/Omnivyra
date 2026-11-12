-- Rollback of 20270217000010_invitations_role_check_content_roles: restores the
-- five-role invitations_role_check. RAISES (nothing changed) if any invitation
-- already carries one of the four content roles - those rows must be resolved
-- first (the rollback never deletes or rewrites data).
DO $pre$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.invitations
   WHERE role IN ('CONTENT_MANAGER', 'CONTENT_PLANNER', 'CONTENT_ENGAGER', 'VIEWER');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'invitations_role_check rollback: % invitation(s) carry a content role - resolve them first; nothing changed', v_bad;
  END IF;
END
$pre$;
ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_role_check CHECK (
  role = ANY (ARRAY['COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'VIEW_ONLY']::text[])
);

-- ===========================================================================
-- ROLLBACK for 20261231000007_identity_verification.sql
--
-- Refuses while data depends on it:
--   * any attestation row exists — it is an audit record; an operator must
--     decide (export, then DELETE) before its table is dropped;
--   * any community link exists — every link made under 20261231000007 was
--     admitted by the evidence guard this removes, and the guard must not be
--     dropped while a link could be read as having passed it.
--
-- Drops ONLY what 20261231000007 added. identity_claims, the 20261231000006
-- identity guard and every other object are left as they are.
-- ===========================================================================

DO $$
BEGIN
  IF to_regclass('public.identity_verification_attestations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.identity_verification_attestations) THEN
    RAISE EXCEPTION 'rollback refused: identity_verification_attestations has rows (audit records); export and remove them first';
  END IF;
  IF to_regclass('public.community_action_journey_links') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.community_action_journey_links) THEN
    RAISE EXCEPTION 'rollback refused: community_action_journey_links has rows admitted by the 20261231000007 evidence guard';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_community_action_journey_links_identity_proof_guard ON public.community_action_journey_links;
DROP FUNCTION IF EXISTS public.community_action_journey_links_identity_proof_guard();
DROP TRIGGER IF EXISTS trg_identity_verification_attestations_guard ON public.identity_verification_attestations;
DROP FUNCTION IF EXISTS public.identity_verification_attestations_guard();
DROP TABLE IF EXISTS public.identity_verification_attestations;

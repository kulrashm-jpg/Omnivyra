-- ROLLBACK for 20261231000010_rpa_legacy_session_invalidation.sql — REFUSED.
--
-- That migration overwrote every legacy plaintext rpa_sessions.storage_state
-- with an 'omnivyra.rpa_session.invalidated' marker. The plaintext cookies
-- were deliberately not copied anywhere, so they cannot be restored, and by
-- product decision they must not be: legacy plaintext RPA sessions are
-- invalidated and each organization logs in again (which writes a fresh
-- encrypted envelope over the marker).
--
-- The audit table public.rpa_session_invalidation_audit holds counts only and
-- is kept as the record of the invalidation; it is not dropped here.
--
-- This file intentionally fails. There is no override.

DO $refuse$
BEGIN
  RAISE EXCEPTION
    'Rollback of 20261231000010_rpa_legacy_session_invalidation refused: '
    'invalidated plaintext RPA sessions cannot and must not be restored. '
    'Affected organizations must log in again.';
END
$refuse$;

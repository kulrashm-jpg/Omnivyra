-- RPA legacy plaintext session invalidation (at rest).
--
-- Product decision: legacy plaintext RPA sessions are INVALIDATED; the
-- organization must log in again. Plaintext cookies are NOT migrated into the
-- encrypted store and are never copied, logged or exposed.
--
-- A valid stored session is the encrypted envelope written by
-- backend/services/rpaWorker/rpaSessionStore.ts (sealRpaSession):
--   { format: 'omnivyra.rpa_session.v1', alg: 'aes-256-gcm',
--     ciphertext: '<24 hex>:<32 hex>:<hex>', account_tier_verified }
-- Every other rpa_sessions.storage_state value (legacy plaintext Playwright
-- storageState, or anything malformed) is overwritten IN PLACE with a marker
-- that holds no cookie material:
--   { format: 'omnivyra.rpa_session.invalidated', reason: 'legacy_plaintext',
--     invalidated_at: <timestamptz> }
-- and the row's self-declared account_tier is cleared and expires_at is
-- clamped to now(), so even a reader that only looks at expires_at treats it
-- as not connected.
--
-- Scrub, not delete: the (organization_id, platform) row is kept so
-- /api/rpa/auth/callback and platform health can say "reauth_required"
-- (reason 'invalidated') instead of looking like a never-connected platform,
-- and last_login_at stays available for support. storage_state is NOT NULL, so
-- the marker is what replaces the blob. The next login (saveRpaSession upsert
-- on organization_id, platform) overwrites the marker with a fresh envelope.
-- Either choice leaves the superseded tuple in the heap until VACUUM; see the
-- operator note at the end.
--
-- Audit: one row per (organization_id, platform, batch) in
-- public.rpa_session_invalidation_audit with a COUNT only — never content.
--
-- Safety:
--   - The predicate matches only rows that are neither a valid envelope nor
--     already the marker, so re-running is a no-op (0 rows, 0 audit rows).
--   - Batched (500 rows per statement, keyed by id) with a hard iteration cap.
--   - No RAISE NOTICE / RAISE LOG / RAISE WARNING of anything. The cookie
--     blob is never selected into a variable; only id / organization_id /
--     platform cross the statement boundary.
--   - No functions, no triggers, no schedules.
--   - Service role only: the audit table has RLS enabled with NO policies and
--     every privilege revoked from PUBLIC, anon and authenticated.
-- Rollback: supabase/migrations/rollbacks/rpa_legacy_session_invalidation_rollback.sql
-- REFUSES — plaintext cannot and must not be restored.

CREATE TABLE IF NOT EXISTS public.rpa_session_invalidation_audit (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id    uuid        NOT NULL,
  platform           text        NOT NULL,
  reason             text        NOT NULL CHECK (reason IN ('legacy_plaintext')),
  rows_invalidated   integer     NOT NULL CHECK (rows_invalidated > 0),
  migration_version  text        NOT NULL,
  invalidated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rpa_session_invalidation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rpa_session_invalidation_audit FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_rpa_session_invalidation_audit_org
  ON public.rpa_session_invalidation_audit (organization_id, platform);

COMMENT ON TABLE public.rpa_session_invalidation_audit IS
  'Counts of legacy plaintext rpa_sessions rows invalidated at rest (per org/platform). '
  'Never holds session content. Written by migration 20261231000010.';

DO $scrub$
DECLARE
  v_batch      integer;
  v_iterations integer := 0;
BEGIN
  LOOP
    WITH candidates AS (
      SELECT s.id
        FROM public.rpa_sessions s
       WHERE NOT (
               COALESCE(
                 jsonb_typeof(s.storage_state) = 'object'
                 AND s.storage_state->>'format' = 'omnivyra.rpa_session.v1'
                 AND s.storage_state->>'alg' = 'aes-256-gcm'
                 AND jsonb_typeof(s.storage_state->'ciphertext') = 'string'
                 AND (s.storage_state->>'ciphertext') ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$',
                 false)
               OR COALESCE(
                 jsonb_typeof(s.storage_state) = 'object'
                 AND s.storage_state->>'format' = 'omnivyra.rpa_session.invalidated',
                 false)
             )
       ORDER BY s.id
       LIMIT 500
       FOR UPDATE
    ),
    scrubbed AS (
      UPDATE public.rpa_sessions s
         SET storage_state = jsonb_build_object(
               'format', 'omnivyra.rpa_session.invalidated',
               'reason', 'legacy_plaintext',
               'invalidated_at', now()),
             account_tier = NULL,
             expires_at   = LEAST(COALESCE(s.expires_at, now()), now()),
             updated_at   = now()
        FROM candidates c
       WHERE s.id = c.id
      RETURNING s.organization_id, s.platform
    ),
    audited AS (
      INSERT INTO public.rpa_session_invalidation_audit
             (organization_id, platform, reason, rows_invalidated, migration_version)
      SELECT organization_id, platform, 'legacy_plaintext', count(*)::integer, '20261231000010'
        FROM scrubbed
       GROUP BY organization_id, platform
      RETURNING rows_invalidated
    )
    SELECT COALESCE(sum(rows_invalidated), 0)::integer INTO v_batch FROM audited;

    EXIT WHEN v_batch = 0;

    v_iterations := v_iterations + 1;
    IF v_iterations > 10000 THEN
      RAISE EXCEPTION 'rpa legacy session invalidation exceeded its iteration bound';
    END IF;
  END LOOP;
END
$scrub$;

-- Postcondition: no rpa_sessions row is left that is neither a valid
-- envelope nor the marker. Reports a count only.
DO $post$
DECLARE
  v_left bigint;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.rpa_sessions s
   WHERE NOT (
           COALESCE(
             jsonb_typeof(s.storage_state) = 'object'
             AND s.storage_state->>'format' = 'omnivyra.rpa_session.v1'
             AND s.storage_state->>'alg' = 'aes-256-gcm'
             AND jsonb_typeof(s.storage_state->'ciphertext') = 'string'
             AND (s.storage_state->>'ciphertext') ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$',
             false)
           OR COALESCE(
             jsonb_typeof(s.storage_state) = 'object'
             AND s.storage_state->>'format' = 'omnivyra.rpa_session.invalidated',
             false)
         );
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'rpa legacy session invalidation postcondition failed: % unscrubbed row(s) remain', v_left;
  END IF;
END
$post$;

-- Operator note (not executed here; VACUUM cannot run inside the migration
-- transaction): the superseded plaintext tuple versions stay in the table's
-- heap until vacuumed. After applying, run
--   VACUUM (VERBOSE OFF) public.rpa_sessions;
-- Plaintext already captured by backups / PITR / WAL archives is outside the
-- reach of any migration and expires with their retention.

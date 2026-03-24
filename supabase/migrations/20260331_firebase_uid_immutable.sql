-- ─────────────────────────────────────────────────────────────────────────────
-- Enforce firebase_uid immutability at the database level
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Once a users row has a firebase_uid set, no UPDATE may change it.
-- This is enforced with a BEFORE UPDATE trigger so it cannot be bypassed
-- by any application code, service-role API call, or direct SQL connection.
--
-- Behaviour:
--   OLD.firebase_uid IS NULL  → new value is accepted (initial assignment)
--   OLD.firebase_uid IS NOT NULL, NEW = OLD  → accepted (no-op)
--   OLD.firebase_uid IS NOT NULL, NEW ≠ OLD  → hard error; UPDATE is aborted
--
-- The trigger fires per-row so partial-update UPSERTs on the email conflict
-- target are safe: the merged row keeps its existing firebase_uid.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION guard_firebase_uid_immutable()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  -- Only block if a value was already set AND it is being changed
  IF OLD.firebase_uid IS NOT NULL
     AND NEW.firebase_uid IS DISTINCT FROM OLD.firebase_uid
  THEN
    RAISE EXCEPTION
      'firebase_uid cannot be changed once set (user_id=%, existing=%, attempted=%)',
      OLD.id, OLD.firebase_uid, NEW.firebase_uid
      USING ERRCODE = 'integrity_constraint_violation'; -- 23000
  END IF;
  RETURN NEW;
END;
$$;

-- Drop first so re-running migration is idempotent
DROP TRIGGER IF EXISTS users_firebase_uid_immutable ON users;

CREATE TRIGGER users_firebase_uid_immutable
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION guard_firebase_uid_immutable();

COMMENT ON FUNCTION guard_firebase_uid_immutable() IS
  'Prevents firebase_uid from being overwritten once set. '
  'Part of Firebase-only auth hardening (20260331).';

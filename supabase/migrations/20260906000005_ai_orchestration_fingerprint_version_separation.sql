-- =============================================================================
-- AI-ORCH-2B.1B — Fingerprint version separation (persistence ONLY).
--
-- Phase 2B.1A stored a single combined tag `fingerprint_algo = 'sha256:v1'`, which
-- conflates THREE independently-evolving concepts:
--   execution_schema_version  — the SET of execution-semantic fields fingerprinted
--   canonicalization_version  — the canonicalization algorithm (key-sort, null-drop, array-order)
--   fingerprint_algorithm     — the hash function ('sha256')
--
-- This migration ADDS three nullable columns to separate them. The existing
-- columns are UNTOUCHED and preserved for backward compatibility:
--   - config_fingerprint  → unchanged (values MUST NOT change; rule 12)
--   - fingerprint_algo     → unchanged, now LEGACY metadata (do not remove/rename)
--
-- Seed for the 10 already-fingerprinted v1 versions:
--   execution_schema_version = 1, canonicalization_version = 1, fingerprint_algorithm = 'sha256'
-- (i.e. the decomposition of the legacy 'sha256:v1' tag). No fingerprint VALUE is
-- recomputed or altered.
--
-- SCOPE: PERSISTENCE ONLY. No resolver, no runtime consumer, no fingerprint
-- recomputation. Additive, nullable, idempotent, reversible. Byte-identical runtime.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

ALTER TABLE public.ai_execution_profile_versions
  ADD COLUMN IF NOT EXISTS execution_schema_version INT  NULL;
ALTER TABLE public.ai_execution_profile_versions
  ADD COLUMN IF NOT EXISTS canonicalization_version INT  NULL;
ALTER TABLE public.ai_execution_profile_versions
  ADD COLUMN IF NOT EXISTS fingerprint_algorithm    TEXT NULL;

-- Seed the decomposition for rows that already carry a fingerprint. Idempotent:
-- only fills NULLs; touches neither config_fingerprint nor the legacy fingerprint_algo.
UPDATE public.ai_execution_profile_versions
SET execution_schema_version = 1,
    canonicalization_version = 1,
    fingerprint_algorithm    = 'sha256'
WHERE config_fingerprint IS NOT NULL
  AND execution_schema_version IS NULL;

-- Audit
INSERT INTO public.config_change_logs (config_type, changed_by, before_json, after_json, note)
SELECT 'ai_fingerprint_version_separation', 'system', NULL,
       jsonb_build_object(
         'execution_schema_version', 1,
         'canonicalization_version', 1,
         'fingerprint_algorithm', 'sha256',
         'rows_seeded', (SELECT count(*) FROM public.ai_execution_profile_versions WHERE fingerprint_algorithm IS NOT NULL)
       ),
       'AI-ORCH-2B.1B fingerprint version separation (inert; config_fingerprint + fingerprint_algo unchanged)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.config_change_logs WHERE config_type = 'ai_fingerprint_version_separation'
);

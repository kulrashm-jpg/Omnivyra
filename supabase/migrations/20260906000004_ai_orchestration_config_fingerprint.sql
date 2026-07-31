-- =============================================================================
-- AI-ORCH-2B.1A — Configuration Fingerprint (persistence support ONLY).
--
-- Every immutable Execution Profile Version gets a deterministic fingerprint of
-- its EFFECTIVE EXECUTION SEMANTICS — for config comparison, audit, cache
-- validation, rollback verification, and execution reproducibility.
--
-- SINGLE SOURCE OF TRUTH: the fingerprint is defined by ONE implementation,
--   backend/services/aiOrchestration/configFingerprint.ts  (algo tag 'sha256:v1')
-- so producer (this seed) and future verifier (later phases) can never drift. The
-- seed values below were computed by THAT util over the exact execution semantics
-- seeded in 20260906000002 (verified by backend/tests/unit/aiConfigFingerprint.test.ts,
-- which recomputes them and asserts equality with these baked values).
--
-- ALGORITHM (documented in the util): canonical JSON over the execution-semantic
-- fields ONLY (mode, quality_tier, capability_requirements, resolved provider/model
-- refs, model_version_tag, deployment_id, resolved routing content, params,
-- modality, reliability, limits, caching, safety content) — EXCLUDING surrogate
-- ids, version numbers, status, timestamps, audit fields, display names,
-- descriptions. Object keys sorted (order-independent); array order preserved
-- (semantic); null == absent. Digest = SHA-256 hex, tagged 'sha256:v1'.
--
-- SCOPE: PERSISTENCE ONLY. No hash is computed at runtime here; no execution path
-- reads these columns in 2B.1A. Additive nullable columns + a one-time seed
-- backfill. Idempotent, reversible, byte-identical runtime behavior.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- ── Columns on the immutable version snapshot ────────────────────────────────
ALTER TABLE public.ai_execution_profile_versions
  ADD COLUMN IF NOT EXISTS config_fingerprint TEXT NULL;
ALTER TABLE public.ai_execution_profile_versions
  ADD COLUMN IF NOT EXISTS fingerprint_algo   TEXT NULL;

-- ── Seed backfill for the 10 v1 profile versions (computed by the canonical util) ─
-- Keyed by profile key + version=1. Idempotent (only fills NULLs). If a seeded
-- profile version is absent (e.g. seed migration not run), the UPDATE is a no-op.
UPDATE public.ai_execution_profile_versions ver
SET config_fingerprint = m.fp, fingerprint_algo = 'sha256:v1'
FROM public.ai_execution_profiles p,
  (VALUES
    ('HIGH_QUALITY',      'sha256:v1:5b17a0c94f04a3d61b979cb2c35750c868987bc777fd893fef9f636363d2b9d3'),
    ('BALANCED',          'sha256:v1:9dbba7cc97a50e79c8bd4bde455514865dad37c3d0ab7601025eb980ffc92910'),
    ('ECONOMY',           'sha256:v1:a6a79f9b5f9474c1c8b7d24114135f946bce392d2c4b1875a6ae3bd93b6f5680'),
    ('JSON_EXTRACTION',   'sha256:v1:9f2689d33ef8a235502cab0abc69e35b28b3e5dcd04a175c0bf26e707dbc6d95'),
    ('DEEP_REASONING',    'sha256:v1:9060abdfc8e6adc662ed861ac30475c898e647969e7aaf789d1edc991859024c'),
    ('CREATIVE_WRITING',  'sha256:v1:ca0f3805c4e336f2707df47ce2a9f6bd823c3b9ba39f7876ccf4b1b324902329'),
    ('GROUNDED_RESEARCH', 'sha256:v1:f8ca06f4ad5e318e121c0dadc07f73ee63efe595406c30f88ec72ab3d7d70146'),
    ('VISION_ANALYSIS',   'sha256:v1:8940955a70589cabad0b9a50ef9861bbcf72bde5e248a95f8974fdfec70370d5'),
    ('IMAGE_GENERATION',  'sha256:v1:c6e55c9b240907a9934dd068ccb0cf871c7d115a2f212cf2b1963484aacd75e2'),
    ('MODERATION',        'sha256:v1:1e17ad3c452367d578f6826e1f4b911d39b75381a9915cc4183edd995279b938')
  ) AS m(key, fp)
WHERE ver.profile_id = p.id
  AND p.key = m.key
  AND ver.version = 1
  AND ver.config_fingerprint IS NULL;

-- ── Audit entry ──────────────────────────────────────────────────────────────
INSERT INTO public.config_change_logs (config_type, changed_by, before_json, after_json, note)
SELECT 'ai_config_fingerprint_seed', 'system', NULL,
       jsonb_build_object(
         'algo', 'sha256:v1',
         'fingerprinted_versions', (SELECT count(*) FROM public.ai_execution_profile_versions WHERE config_fingerprint IS NOT NULL)
       ),
       'AI-ORCH-2B.1A fingerprint backfill (inert; single-source util backend/services/aiOrchestration/configFingerprint.ts)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.config_change_logs WHERE config_type = 'ai_config_fingerprint_seed'
);

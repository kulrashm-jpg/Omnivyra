-- Step R1 — Additive Creator render-domain substrate + immutable lineage
--
-- PURE ADDITIVE / SIDECAR. Creates the durable render-domain tables the
-- future rendering infrastructure (R3+) will use. NOTHING here activates
-- rendering: no provider runtime, no queue runtime, no workspace/
-- scheduler wiring, no changes to any existing table. Zero runtime
-- behavior change.
--
-- Reuses the EXISTING enterprise substrate (no parallel systems):
--   * public.raise_ledger_immutable()      (20260663) — immutable guard
--   * public.omnivyra_touch_updated_at()    — mutable updated_at touch
--   * public.billing_operations(id)         (20260663) — financial linkage
--   * public.job_execution_registry         (20260663) — exactly-once key
--                                             (linked logically via
--                                              execution_hash, like
--                                              billing_operations does
--                                              with idempotency_key)
--
-- Sections:
--   §1  creator_render_job                (immutable render intent lineage)
--   §2  creator_render_job_state          (mutable side state, monotonic)
--   §3  creator_render_variant            (immutable platform/aspect lineage)
--   §4  creator_render_provider           (config-mutable registry)
--   §5  creator_render_attempt            (append-only provider history)
--   §6  creator_render_output             (immutable output versioning)
--   §7  creator_render_moderation_event   (immutable moderation audit)
--   §8  monotonic lifecycle guard
--   §9  indexes
--
-- Lifecycle vocabulary mirrors the Step-R0 RenderLifecycleState contract
-- 1:1 (single source of truth).

------------------------------------------------------------------------------
-- §1  IMMUTABLE RENDER JOB LINEAGE
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_render_job (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id             text,
  task_id                  text NOT NULL,
  card_id                  text NOT NULL,
  organization_id          uuid NOT NULL,
  canonical_asset_family   text NOT NULL
    CHECK (canonical_asset_family IN ('image','carousel','video','post_with_asset')),
  render_modality          text NOT NULL CHECK (render_modality IN ('image','video')),
  deterministic_input_hash text NOT NULL,
  -- IMMUTABLE FOREVER: the exact RenderSpec the intent was derived from.
  render_spec_snapshot     jsonb NOT NULL,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  -- Idempotency: an identical render intent for an org is ONE job
  -- (Validation-7 deterministic-hash uniqueness).
  UNIQUE (organization_id, deterministic_input_hash)
);

DROP TRIGGER IF EXISTS creator_render_job_immutable_update ON public.creator_render_job;
CREATE TRIGGER creator_render_job_immutable_update
  BEFORE UPDATE ON public.creator_render_job
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS creator_render_job_immutable_delete ON public.creator_render_job;
CREATE TRIGGER creator_render_job_immutable_delete
  BEFORE DELETE ON public.creator_render_job
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §2  MUTABLE SIDE STATE (1:1 with the immutable job)
------------------------------------------------------------------------------
-- The financial/lineage truth is immutable in §1; operational lifecycle
-- lives here and is freely UPDATEable but lifecycle-monotonic (§8).
CREATE TABLE IF NOT EXISTS public.creator_render_job_state (
  render_job_id        uuid PRIMARY KEY
    REFERENCES public.creator_render_job(id) ON DELETE RESTRICT,
  current_state        text NOT NULL DEFAULT 'queued'
    CHECK (current_state IN (
      'queued','preparing','rendering','processing','moderation',
      'approval_ready','completed','attached','scheduling_ready',
      'retry_scheduled','failover_pending','handed_to_human',
      'failed_render','failed_moderation_pre','failed_moderation_post',
      'failed_provider_exhausted','failed_timeout',
      'cancelled_by_user','cancelled_superseded','cancelled_quota'
    )),
  retry_count          integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  active_provider      text,
  moderation_state     text NOT NULL DEFAULT 'pending'
    CHECK (moderation_state IN ('pending','pre_passed','post_passed','blocked','needs_review')),
  attached_output_id   uuid,   -- FK added after §6 (forward reference)
  last_transition_at   timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_crjs_touch ON public.creator_render_job_state;
CREATE TRIGGER trg_crjs_touch
  BEFORE UPDATE ON public.creator_render_job_state
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

------------------------------------------------------------------------------
-- §3  IMMUTABLE VARIANT LINEAGE (job × platform × aspect/spec)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_render_variant (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id     uuid NOT NULL REFERENCES public.creator_render_job(id) ON DELETE RESTRICT,
  platform          text NOT NULL,
  aspect_ratio      text NOT NULL,
  resolution        jsonb NOT NULL,            -- { "w": int, "h": int }
  spec_fingerprint  text NOT NULL,
  production_source text NOT NULL DEFAULT 'ai_render'
    CHECK (production_source IN ('ai_render','human_upload','external')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (render_job_id, spec_fingerprint),
  UNIQUE (render_job_id, platform, aspect_ratio)
);

DROP TRIGGER IF EXISTS creator_render_variant_immutable_update ON public.creator_render_variant;
CREATE TRIGGER creator_render_variant_immutable_update
  BEFORE UPDATE ON public.creator_render_variant
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS creator_render_variant_immutable_delete ON public.creator_render_variant;
CREATE TRIGGER creator_render_variant_immutable_delete
  BEFORE DELETE ON public.creator_render_variant
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §4  PROVIDER REGISTRY (config-mutable)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_render_provider (
  provider_key      text PRIMARY KEY,
  capability_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_state      text NOT NULL DEFAULT 'maintenance'
    CHECK (health_state IN ('healthy','degraded','circuit_open','maintenance')),
  outage_window     tstzrange,
  rate_limit_state  jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority_weight   integer NOT NULL DEFAULT 100 CHECK (priority_weight >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_crp_touch ON public.creator_render_provider;
CREATE TRIGGER trg_crp_touch
  BEFORE UPDATE ON public.creator_render_provider
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- Seed known providers as NON-usable placeholders (health=maintenance,
-- empty capability). A later step populates real capabilities. Seeding
-- here does NOT activate anything — there is no provider runtime.
INSERT INTO public.creator_render_provider (provider_key, health_state)
VALUES ('openai','maintenance'),('runway','maintenance'),
       ('pika','maintenance'),('stability','maintenance')
ON CONFLICT (provider_key) DO NOTHING;

------------------------------------------------------------------------------
-- §5  APPEND-ONLY ATTEMPT HISTORY (financial-evidential)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_render_attempt (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id                 uuid NOT NULL
    REFERENCES public.creator_render_variant(id) ON DELETE RESTRICT,
  provider_key               text NOT NULL
    REFERENCES public.creator_render_provider(provider_key) ON DELETE RESTRICT,
  attempt_number             integer NOT NULL CHECK (attempt_number >= 1),
  idempotency_key            text NOT NULL,
  provider_request_snapshot  jsonb,
  provider_response_snapshot jsonb,
  -- Financial linkage to the EXISTING immutable ledger. RESTRICT so a
  -- billing row can never be deleted out from under an attempt.
  billing_operation_id       uuid REFERENCES public.billing_operations(id) ON DELETE RESTRICT,
  -- Logical exactly-once link to job_execution_registry (same pattern as
  -- billing_operations.idempotency_key — text + index, not a hard FK,
  -- because the registry row may be claimed in a different unit of work).
  execution_hash             text NOT NULL,
  status                     text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','in_progress','succeeded','failed','cancelled','timed_out')),
  error_code                 text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, attempt_number),
  UNIQUE (execution_hash)
);

DROP TRIGGER IF EXISTS creator_render_attempt_immutable_update ON public.creator_render_attempt;
CREATE TRIGGER creator_render_attempt_immutable_update
  BEFORE UPDATE ON public.creator_render_attempt
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS creator_render_attempt_immutable_delete ON public.creator_render_attempt;
CREATE TRIGGER creator_render_attempt_immutable_delete
  BEFORE DELETE ON public.creator_render_attempt
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §6  IMMUTABLE OUTPUT VERSIONING (re-render = NEW row)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_render_output (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id             uuid NOT NULL
    REFERENCES public.creator_render_attempt(id) ON DELETE RESTRICT,
  storage_ref            text NOT NULL,
  content_sha256         text NOT NULL,
  modality               text NOT NULL CHECK (modality IN ('image','video')),
  mime_type              text,
  byte_size              bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  version                integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  moderation_state       text NOT NULL DEFAULT 'pending'
    CHECK (moderation_state IN ('pending','allowed','blocked','needs_review')),
  derivative_of_output_id uuid REFERENCES public.creator_render_output(id) ON DELETE RESTRICT,
  supersedes_output_id    uuid REFERENCES public.creator_render_output(id) ON DELETE RESTRICT,
  retention_until        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, version)
);

DROP TRIGGER IF EXISTS creator_render_output_immutable_update ON public.creator_render_output;
CREATE TRIGGER creator_render_output_immutable_update
  BEFORE UPDATE ON public.creator_render_output
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS creator_render_output_immutable_delete ON public.creator_render_output;
CREATE TRIGGER creator_render_output_immutable_delete
  BEFORE DELETE ON public.creator_render_output
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

-- Now the forward FK from §2 (state → attached output). NOT VALID-free:
-- table is empty at migration time so the constraint is cheap.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'creator_render_job_state_attached_output_fk'
  ) THEN
    ALTER TABLE public.creator_render_job_state
      ADD CONSTRAINT creator_render_job_state_attached_output_fk
      FOREIGN KEY (attached_output_id)
      REFERENCES public.creator_render_output(id) ON DELETE RESTRICT;
  END IF;
END $$;

------------------------------------------------------------------------------
-- §7  IMMUTABLE MODERATION AUDIT (fail-closed evidence)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_render_moderation_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type      text NOT NULL CHECK (subject_type IN ('render_spec','render_output')),
  subject_hash      text NOT NULL,            -- spec hash (pre) | content_sha256 (post)
  moderation_phase  text NOT NULL CHECK (moderation_phase IN ('pre_render','post_render')),
  policy_version    text NOT NULL,
  -- Fail-closed: a decision is only 'allowed' when a gate explicitly says
  -- so. Absence is NOT modeled as allowed anywhere.
  moderation_result text NOT NULL CHECK (moderation_result IN ('allowed','blocked','needs_review')),
  findings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  moderator_source  text NOT NULL,            -- 'classifier:<v>' | 'human:<id>' | 'fail_closed'
  render_job_id     uuid REFERENCES public.creator_render_job(id) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS creator_render_moderation_immutable_update ON public.creator_render_moderation_event;
CREATE TRIGGER creator_render_moderation_immutable_update
  BEFORE UPDATE ON public.creator_render_moderation_event
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS creator_render_moderation_immutable_delete ON public.creator_render_moderation_event;
CREATE TRIGGER creator_render_moderation_immutable_delete
  BEFORE DELETE ON public.creator_render_moderation_event
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §8  MONOTONIC LIFECYCLE GUARD (terminal states frozen)
------------------------------------------------------------------------------
-- Mirrors guard_jer_status_monotonic (20260663). Once render lifecycle
-- reaches a terminal/exit state it can never regress or change — the
-- operational analogue of immutable financial history.
CREATE OR REPLACE FUNCTION public.guard_render_state_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal CONSTANT text[] := ARRAY[
    'scheduling_ready','handed_to_human',
    'failed_render','failed_moderation_pre','failed_moderation_post',
    'failed_provider_exhausted','failed_timeout',
    'cancelled_by_user','cancelled_superseded','cancelled_quota'
  ];
BEGIN
  IF OLD.current_state = ANY (v_terminal) AND NEW.current_state <> OLD.current_state THEN
    RAISE EXCEPTION
      'RENDER_STATE_FROZEN: % is terminal, cannot transition to % (job=%)',
      OLD.current_state, NEW.current_state, OLD.render_job_id
      USING ERRCODE = 'P0001';
  END IF;
  -- retry_count is monotonic non-decreasing.
  IF NEW.retry_count < OLD.retry_count THEN
    RAISE EXCEPTION 'RENDER_RETRY_MONOTONIC: retry_count cannot decrease (% -> %)',
      OLD.retry_count, NEW.retry_count USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_crjs_monotonic ON public.creator_render_job_state;
CREATE TRIGGER guard_crjs_monotonic
  BEFORE UPDATE ON public.creator_render_job_state
  FOR EACH ROW EXECUTE FUNCTION public.guard_render_state_monotonic();

------------------------------------------------------------------------------
-- §9  INDEXES (prepare for future queue throughput)
------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crj_hash      ON public.creator_render_job(deterministic_input_hash);
CREATE INDEX IF NOT EXISTS idx_crj_org       ON public.creator_render_job(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crj_blueprint ON public.creator_render_job(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_crj_task      ON public.creator_render_job(task_id);
CREATE INDEX IF NOT EXISTS idx_crj_card      ON public.creator_render_job(card_id);

CREATE INDEX IF NOT EXISTS idx_crjs_state
  ON public.creator_render_job_state(current_state, last_transition_at);
CREATE INDEX IF NOT EXISTS idx_crjs_open
  ON public.creator_render_job_state(current_state)
  WHERE current_state IN ('queued','preparing','rendering','processing','moderation','retry_scheduled','failover_pending');

CREATE INDEX IF NOT EXISTS idx_crv_job      ON public.creator_render_variant(render_job_id);
CREATE INDEX IF NOT EXISTS idx_crv_platform ON public.creator_render_variant(platform);

CREATE INDEX IF NOT EXISTS idx_cra_variant  ON public.creator_render_attempt(variant_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_cra_exec     ON public.creator_render_attempt(execution_hash);
CREATE INDEX IF NOT EXISTS idx_cra_billing
  ON public.creator_render_attempt(billing_operation_id) WHERE billing_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cra_status   ON public.creator_render_attempt(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cro_attempt  ON public.creator_render_output(attempt_id);
CREATE INDEX IF NOT EXISTS idx_cro_sha      ON public.creator_render_output(content_sha256);
CREATE INDEX IF NOT EXISTS idx_cro_mod      ON public.creator_render_output(moderation_state);
CREATE INDEX IF NOT EXISTS idx_cro_retain
  ON public.creator_render_output(retention_until) WHERE retention_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crme_subject ON public.creator_render_moderation_event(subject_hash);
CREATE INDEX IF NOT EXISTS idx_crme_phase
  ON public.creator_render_moderation_event(subject_type, moderation_phase, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crme_job     ON public.creator_render_moderation_event(render_job_id);

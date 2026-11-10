-- Engagement request idempotency — durable request records for
-- /api/engagement/reply and /api/engagement/like.
--
-- ONE record per (organization, acting user, scope, idempotency key). It is
-- NOT a second action ledger: it reserves the request BEFORE any external
-- call, binds the key to a canonical payload fingerprint, and points at the
-- ONE community_ai_actions row the attempt produced (action_id). The action's
-- outcome lives in community_ai_actions.
-- Application contract: backend/services/engagementRequestIdempotency.ts.
--
--   id                  deterministic uuid of (organization, actor, scope, key)
--                       — the PRIMARY KEY is the atomic reservation: a plain
--                       INSERT either creates it or fails 23505.
--   state               reserved | completed | failed_not_acted | uncertain
--   attempt             1.. ; a provably-not-acted attempt may be retried with
--                       the SAME key (attempt+1, new action_id, compare-and-set)
--   action_id           planned community_ai_actions.id of THIS attempt. Not a
--                       foreign key: it is reserved before the action row exists
--                       (and a stale reservation is fenced by inserting an action
--                       row under this id).
--   expires_at          replay window (24 h after the last transition). Expired
--                       completed / failed_not_acted records may be taken over;
--                       reserved / uncertain never expire into a resend.
--
-- Lifecycle cleanup is the bounded application function
-- purgeExpiredEngagementRequests (no cron / schedule is added here).
--
-- Service role only: RLS enabled with NO policies, and every privilege revoked
-- from PUBLIC, anon and authenticated. No functions are created.
-- Idempotent: IF NOT EXISTS / guarded. Pre- and postconditions. NOT applied
-- anywhere yet.
-- ROLLBACK: supabase/migrations/rollbacks/engagement_request_idempotency_rollback.sql

-- ── Preconditions ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'engagement request idempotency: public.companies is absent';
  END IF;
  IF to_regclass('public.community_ai_actions') IS NULL THEN
    RAISE EXCEPTION 'engagement request idempotency: public.community_ai_actions is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.community_ai_actions'::regclass
       AND conname = 'community_ai_actions_status_check'
       AND pg_get_constraintdef(oid) LIKE '%uncertain%'
  ) THEN
    RAISE EXCEPTION 'engagement request idempotency: community_ai_actions status vocabulary lacks ''uncertain'' (apply 20261231000002 first)';
  END IF;
END
$$;

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engagement_request_idempotency (
  id                  uuid        PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  actor_id            text        NOT NULL,
  scope               text        NOT NULL,
  idempotency_key     text        NOT NULL,
  key_source          text        NOT NULL,
  request_fingerprint text        NOT NULL,
  state               text        NOT NULL,
  attempt             integer     NOT NULL DEFAULT 1,
  action_id           uuid        NOT NULL,
  platform            text,
  action_type         text,
  target_id           text,
  outcome_status      text,
  outcome_error       text,
  reserved_at         timestamptz NOT NULL DEFAULT now(),
  finalized_at        timestamptz,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_request_idempotency_scope_check
    CHECK (scope IN ('reply', 'like')),
  CONSTRAINT engagement_request_idempotency_state_check
    CHECK (state IN ('reserved', 'completed', 'failed_not_acted', 'uncertain')),
  CONSTRAINT engagement_request_idempotency_key_source_check
    CHECK (key_source IN ('client', 'derived')),
  CONSTRAINT engagement_request_idempotency_key_shape_check
    CHECK (
      (key_source = 'client'  AND idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$')
      OR (key_source = 'derived' AND idempotency_key ~ '^derived:[0-9a-f]{64}$')
    ),
  CONSTRAINT engagement_request_idempotency_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT engagement_request_idempotency_attempt_check
    CHECK (attempt >= 1),
  CONSTRAINT engagement_request_idempotency_actor_check
    CHECK (length(actor_id) BETWEEN 1 AND 200),
  CONSTRAINT engagement_request_idempotency_finalized_check
    CHECK ((state = 'reserved') = (finalized_at IS NULL))
);

-- The natural key (defence in depth: the deterministic id already encodes it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_request_idempotency_key
  ON public.engagement_request_idempotency (organization_id, actor_id, scope, idempotency_key);

-- One request record per planned action id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_request_idempotency_action
  ON public.engagement_request_idempotency (action_id);

-- Retention cleanup: completed / failed_not_acted past expiry.
CREATE INDEX IF NOT EXISTS ix_engagement_request_idempotency_expiry
  ON public.engagement_request_idempotency (organization_id, expires_at)
  WHERE state IN ('completed', 'failed_not_acted');

-- Stale-reservation reconciliation.
CREATE INDEX IF NOT EXISTS ix_engagement_request_idempotency_reserved
  ON public.engagement_request_idempotency (reserved_at)
  WHERE state = 'reserved';

-- ── Access: service role only ─────────────────────────────────────────────────
ALTER TABLE public.engagement_request_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.engagement_request_idempotency FROM PUBLIC;
REVOKE ALL ON TABLE public.engagement_request_idempotency FROM anon;
REVOKE ALL ON TABLE public.engagement_request_idempotency FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.engagement_request_idempotency TO service_role;

COMMENT ON TABLE public.engagement_request_idempotency IS
  'Request-level idempotency for engagement reply/like (engagementRequestIdempotency.ts). Not an action ledger: action_id points at the community_ai_actions row of the current attempt. uncertain = may have reached the platform; never resent, never purged.';

-- ── Postconditions ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.engagement_request_idempotency'::regclass) THEN
    RAISE EXCEPTION 'engagement request idempotency postcondition: RLS is not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_request_idempotency') THEN
    RAISE EXCEPTION 'engagement request idempotency postcondition: unexpected RLS policy present';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_roles r
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv)
     WHERE r.rolname IN ('anon', 'authenticated')
       AND has_table_privilege(r.rolname, 'public.engagement_request_idempotency', p.priv)
  ) THEN
    RAISE EXCEPTION 'engagement request idempotency postcondition: anon/authenticated still hold privileges';
  END IF;
  IF to_regclass('public.uq_engagement_request_idempotency_key') IS NULL THEN
    RAISE EXCEPTION 'engagement request idempotency postcondition: natural-key unique index is missing';
  END IF;
END
$$;
